import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPendingMigrations, MigrationDatabase } from '../migrate';

const migrationPath = join(__dirname, '006_production_hardening.sql');
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runDatabaseTests = testDatabaseUrl ? describe : describe.skip;

describe('006_production_hardening migration contract', () => {
  it('defines production ledger lifecycle constraints', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE idempotency_records');
    expect(sql).toContain('CREATE TABLE audit_events');
    expect(sql).toContain("'rejected'");
    expect(sql).toContain('expense_key');
  });
});

runDatabaseTests('006_production_hardening upgrade', () => {
  const schema = `production_hardening_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    const migrations = [
      '001_initial.sql',
      '002_preserve_membership_history.sql',
      '003_authorized_services.sql',
      '004_receipt_storage.sql',
      '005_owner_continuity.sql',
      '006_production_hardening.sql',
    ].map((id) => ({ id, sql: readFileSync(join(__dirname, id), 'utf8') }));
    await applyPendingMigrations(client as unknown as MigrationDatabase, migrations);
    await client.query(`
      INSERT INTO users (id, firebase_uid, email, name) VALUES
        ('11111111-1111-4111-8111-111111111111', 'firebase-u1', 'one@example.com', 'One'),
        ('22222222-2222-4222-8222-222222222222', 'firebase-u2', 'two@example.com', 'Two'),
        ('33333333-3333-4333-8333-333333333333', 'firebase-u3', 'three@example.com', 'Three')
    `);
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO trips (id, name, room_code, owner_membership_id) VALUES
        ('trip-inr', 'INR trip', 'INRONLY', 'member-one'),
        ('trip-usd', 'USD trip', 'USDONLY', 'member-two')
    `);
    await client.query(`
      INSERT INTO trip_memberships (id, trip_id, user_id, display_name, role) VALUES
        ('member-one', 'trip-inr', '11111111-1111-4111-8111-111111111111', 'One', 'owner'),
        ('member-two', 'trip-usd', '22222222-2222-4222-8222-222222222222', 'Two', 'owner'),
        ('member-three', 'trip-inr', '33333333-3333-4333-8333-333333333333', 'Three', 'member')
    `);
    await client.query('COMMIT');
  });

  afterAll(async () => {
    try {
      if (client) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      if (client) client.release();
      await pool.end();
    }
  });

  it('defaults currency to INR and keeps a trip currency immutable', async () => {
    await expect(client.query(
      "SELECT currency FROM trips WHERE id = 'trip-inr'",
    )).resolves.toMatchObject({ rows: [{ currency: 'INR' }] });
    await expect(client.query(
      "UPDATE trips SET currency = 'EUR' WHERE id = 'trip-inr'",
    )).rejects.toThrow();
  });

  it('enforces expense version lifecycle and trip currency', async () => {
    await expect(client.query(`
      INSERT INTO expenses
        (id, trip_id, paid_by_membership_id, description, total_minor, currency,
         expense_key, version, status, voided_at)
      VALUES ('voided-expense', 'trip-inr', 'member-one', 'Voided', 100, 'INR',
              'meal-1', 1, 'voided', NULL)
    `)).rejects.toThrow();

    await client.query('BEGIN');
    await client.query(`
      INSERT INTO expenses
        (id, trip_id, paid_by_membership_id, description, total_minor, currency,
         expense_key, version, status, voided_at)
      VALUES ('active-expense', 'trip-inr', 'member-one', 'Active', 100, 'INR',
              'meal-1', 1, 'active', NULL)
    `);
    await client.query(`
      INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor)
      VALUES ('active-expense', 'trip-inr', 'member-one', 100)
    `);
    await client.query('COMMIT');

    await expect(client.query(`
      INSERT INTO expenses
        (id, trip_id, paid_by_membership_id, description, total_minor, currency,
         expense_key, version, status)
      VALUES ('duplicate-version', 'trip-inr', 'member-one', 'Duplicate', 100, 'INR',
              'meal-1', 1, 'active')
    `)).rejects.toThrow();

    await client.query('BEGIN');
    await client.query(`
      INSERT INTO expenses
        (id, trip_id, paid_by_membership_id, description, total_minor, currency,
         expense_key, version, status)
      VALUES ('wrong-currency', 'trip-inr', 'member-one', 'Wrong currency', 100, 'USD',
              'meal-2', 1, 'active')
    `);
    await client.query(`
      INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor)
      VALUES ('wrong-currency', 'trip-inr', 'member-one', 100)
    `);
    await expect(client.query('COMMIT')).rejects.toThrow();
  });

  it('enforces payment transitions and confirmation membership scope', async () => {
    await expect(client.query(`
      INSERT INTO payments
        (id, trip_id, payer_membership_id, payee_membership_id, amount_minor, status)
      VALUES ('invalid-payment', 'trip-inr', 'member-one', 'member-three', 100, 'rejected')
    `)).rejects.toThrow();

    await expect(client.query(`
      INSERT INTO payments
        (id, trip_id, payer_membership_id, payee_membership_id, amount_minor, status,
         rejected_at, rejected_by_membership_id)
      VALUES ('wrong-confirmation-scope', 'trip-inr', 'member-one', 'member-three', 100, 'rejected',
              now(), 'member-two')
    `)).rejects.toThrow();
  });

  it('protects token, idempotency, and audit record contracts with indexes', async () => {
    await expect(client.query(`
      INSERT INTO trip_invites
        (id, trip_id, email, invited_by_membership_id, token_hash)
      VALUES ('bad-token', 'trip-inr', 'invite@example.com', 'member-one', 'not-a-sha256')
    `)).rejects.toThrow();

    await client.query(`
      INSERT INTO idempotency_records
        (id, actor_membership_id, operation, idempotency_key, request_hash, response_status, response_body)
      VALUES ('idempotency-1', 'member-one', 'expense.create', 'key-1',
              repeat('a', 64), 201, '{"id":"expense-1"}'::jsonb)
    `);
    await expect(client.query(`
      INSERT INTO idempotency_records
        (id, actor_membership_id, operation, idempotency_key, request_hash, response_status, response_body)
      VALUES ('idempotency-2', 'member-one', 'expense.create', 'key-1',
              repeat('b', 64), 201, '{}'::jsonb)
    `)).rejects.toThrow();

    await client.query(`
      INSERT INTO audit_events
        (id, actor_membership_id, action, entity_type, entity_id, metadata)
      VALUES ('audit-1', 'member-one', 'expense.created', 'expense', 'expense-1', '{}'::jsonb)
    `);

    await expect(client.query(`
      SELECT indexname
        FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname IN (
           'expenses_trip_expense_key_version_idx',
           'trip_invites_token_hash_idx',
           'idempotency_records_actor_operation_key_idx',
           'audit_events_entity_created_at_idx'
         )
       ORDER BY indexname
    `)).resolves.toMatchObject({ rows: [
      { indexname: 'audit_events_entity_created_at_idx' },
      { indexname: 'expenses_trip_expense_key_version_idx' },
      { indexname: 'idempotency_records_actor_operation_key_idx' },
      { indexname: 'trip_invites_token_hash_idx' },
    ] });
  });
});
