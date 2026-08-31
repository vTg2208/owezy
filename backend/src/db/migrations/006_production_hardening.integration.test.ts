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
      INSERT INTO payments (id, trip_id, payer_membership_id, payee_membership_id, amount_minor)
      VALUES ('default-pending', 'trip-inr', 'member-one', 'member-three', 100)
      RETURNING status
    `)).resolves.toMatchObject({ rows: [{ status: 'pending' }] });

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

    await expect(client.query(`
      INSERT INTO idempotency_records
        (id, actor_membership_id, operation, idempotency_key, request_hash)
      VALUES ('idempotency-1', 'member-one', 'expense.create', 'key-1',
              repeat('a', 64))
    `)).resolves.toMatchObject({ rowCount: 1 });
    await client.query(`
      UPDATE idempotency_records
         SET response_status = 201,
             response_body = '{"id":"expense-1"}'::jsonb,
             completed_at = now()
       WHERE id = 'idempotency-1'
    `);
    await expect(client.query(`
      INSERT INTO idempotency_records
        (id, actor_membership_id, operation, idempotency_key, request_hash, response_status, response_body, completed_at)
      VALUES ('idempotency-2', 'member-one', 'expense.create', 'key-1',
              repeat('b', 64), 201, '{}'::jsonb, now())
    `)).rejects.toThrow();
    await expect(client.query(`
      UPDATE idempotency_records SET response_status = 202 WHERE id = 'idempotency-1'
    `)).rejects.toThrow('idempotency responses are immutable');
    await expect(client.query(
      "DELETE FROM idempotency_records WHERE id = 'idempotency-1'",
    )).rejects.toThrow('idempotency records cannot be deleted');

    await client.query(`
      INSERT INTO audit_events
        (id, actor_membership_id, action, entity_type, entity_id, metadata)
      VALUES ('audit-1', 'member-one', 'expense.created', 'expense', 'expense-1', '{}'::jsonb)
    `);
    await expect(client.query(
      "UPDATE audit_events SET metadata = '{\"changed\":true}'::jsonb WHERE id = 'audit-1'",
    )).rejects.toThrow('audit events are immutable');
    await expect(client.query(
      "DELETE FROM audit_events WHERE id = 'audit-1'",
    )).rejects.toThrow('audit events are immutable');

    await expect(client.query(`
      SELECT indexname
        FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname IN (
           'expenses_trip_expense_key_version_idx',
           'expenses_one_active_version_per_key_idx',
           'payments_trip_status_created_at_idx',
           'trip_invites_token_hash_idx',
           'trip_invites_pending_expiry_idx',
           'idempotency_records_actor_operation_key_idx',
           'audit_events_entity_created_at_idx',
           'audit_events_actor_created_at_idx'
         )
       ORDER BY indexname
    `)).resolves.toMatchObject({ rows: [
      { indexname: 'audit_events_actor_created_at_idx' },
      { indexname: 'audit_events_entity_created_at_idx' },
      { indexname: 'expenses_one_active_version_per_key_idx' },
      { indexname: 'expenses_trip_expense_key_version_idx' },
      { indexname: 'idempotency_records_actor_operation_key_idx' },
      { indexname: 'payments_trip_status_created_at_idx' },
      { indexname: 'trip_invites_pending_expiry_idx' },
      { indexname: 'trip_invites_token_hash_idx' },
    ] });

    await expect(client.query(`
      SELECT conname
        FROM pg_constraint
       WHERE conrelid IN (
         'trips'::regclass,
         'expenses'::regclass,
         'payments'::regclass,
         'trip_invites'::regclass,
         'idempotency_records'::regclass,
         'audit_events'::regclass
       )
         AND conname IN (
           'trips_currency_check',
           'expenses_expense_key_check',
           'expenses_status_check',
           'expenses_version_check',
           'expenses_voided_lifecycle_check',
           'expenses_trip_currency_fkey',
           'payments_status_check',
           'payments_lifecycle_check',
           'payments_trip_currency_fkey',
           'payments_confirmed_by_membership_fkey',
           'payments_rejected_by_membership_fkey',
           'payments_cancelled_by_membership_fkey',
           'trip_invites_token_hash_check',
           'idempotency_records_completion_check',
           'idempotency_records_actor_membership_id_fkey',
           'audit_events_actor_membership_id_fkey'
         )
       ORDER BY conname
    `)).resolves.toMatchObject({ rows: [
      { conname: 'audit_events_actor_membership_id_fkey' },
      { conname: 'expenses_expense_key_check' },
      { conname: 'expenses_status_check' },
      { conname: 'expenses_trip_currency_fkey' },
      { conname: 'expenses_version_check' },
      { conname: 'expenses_voided_lifecycle_check' },
      { conname: 'idempotency_records_actor_membership_id_fkey' },
      { conname: 'idempotency_records_completion_check' },
      { conname: 'payments_cancelled_by_membership_fkey' },
      { conname: 'payments_confirmed_by_membership_fkey' },
      { conname: 'payments_lifecycle_check' },
      { conname: 'payments_rejected_by_membership_fkey' },
      { conname: 'payments_status_check' },
      { conname: 'payments_trip_currency_fkey' },
      { conname: 'trip_invites_token_hash_check' },
      { conname: 'trips_currency_check' },
    ] });
  });

  it('allows only an expense void after the financial record is created', async () => {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO expenses
        (id, trip_id, paid_by_membership_id, description, total_minor, expense_key)
      VALUES ('append-only-expense', 'trip-inr', 'member-one', 'Original', 100, 'append-only')
    `);
    await client.query(`
      INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor)
      VALUES ('append-only-expense', 'trip-inr', 'member-one', 100)
    `);
    await client.query('COMMIT');

    await expect(client.query(`
      UPDATE expenses SET description = 'Rewritten' WHERE id = 'append-only-expense'
    `)).rejects.toThrow('expenses are append-only');
    await expect(client.query(`
      UPDATE expense_splits SET membership_id = 'member-three'
       WHERE expense_id = 'append-only-expense' AND membership_id = 'member-one'
    `)).rejects.toThrow('expense splits are append-only');
    await expect(client.query(`
      DELETE FROM expense_splits
       WHERE expense_id = 'append-only-expense' AND membership_id = 'member-one'
    `)).rejects.toThrow('expense splits are append-only');
    await expect(client.query(
      "DELETE FROM expenses WHERE id = 'append-only-expense'",
    )).rejects.toThrow('expenses are append-only');
    await expect(client.query(`
      UPDATE expenses
         SET status = 'voided', voided_at = now(), updated_at = now()
       WHERE id = 'append-only-expense'
    `)).resolves.toMatchObject({ rowCount: 1 });
    await expect(client.query(`
      UPDATE expenses SET voided_at = now() WHERE id = 'append-only-expense'
    `)).rejects.toThrow('expenses are append-only');
  });

  it('permits one pending payment transition and freezes terminal payments', async () => {
    const createPending = (id: string) => client.query(`
      INSERT INTO payments (id, trip_id, payer_membership_id, payee_membership_id, amount_minor)
      VALUES ('${id}', 'trip-inr', 'member-one', 'member-three', 100)
    `);
    await createPending('payment-confirm');
    await createPending('payment-reject');
    await createPending('payment-cancel');
    await createPending('payment-rewrite');

    await expect(client.query(`
      UPDATE payments
         SET status = 'confirmed', confirmed_at = now(), confirmed_by_membership_id = 'member-three'
       WHERE id = 'payment-confirm'
    `)).resolves.toMatchObject({ rowCount: 1 });
    await expect(client.query(`
      UPDATE payments
         SET status = 'rejected', rejected_at = now(), rejected_by_membership_id = 'member-three'
       WHERE id = 'payment-reject'
    `)).resolves.toMatchObject({ rowCount: 1 });
    await expect(client.query(`
      UPDATE payments
         SET status = 'cancelled', cancelled_at = now(), cancelled_by_membership_id = 'member-one'
       WHERE id = 'payment-cancel'
    `)).resolves.toMatchObject({ rowCount: 1 });
    await expect(client.query(`
      UPDATE payments SET confirmed_at = now() WHERE id = 'payment-confirm'
    `)).rejects.toThrow('payment state is terminal');
    await expect(client.query(`
      UPDATE payments SET amount_minor = 101 WHERE id = 'payment-rewrite'
    `)).rejects.toThrow('payments may only transition from pending once');
  });
});

const priorMigrationNames = [
  '001_initial.sql',
  '002_preserve_membership_history.sql',
  '003_authorized_services.sql',
  '004_receipt_storage.sql',
  '005_owner_continuity.sql',
];
const allMigrationNames = [...priorMigrationNames, '006_production_hardening.sql'];

runDatabaseTests('006_production_hardening legacy upgrade', () => {
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  let client: PoolClient;
  let legacySchema: string;
  let mixedSchema: string;

  async function createLegacyFinancialSchema(schema: string, currencies: readonly string[]): Promise<void> {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await applyPendingMigrations(client as unknown as MigrationDatabase, priorMigrationNames.map((id) => ({
      id, sql: readFileSync(join(__dirname, id), 'utf8'),
    })));
    await client.query(`
      INSERT INTO users (id, firebase_uid, email, name) VALUES
        ('44444444-4444-4444-8444-444444444444', 'legacy-one', 'legacy-one@example.com', 'Legacy One'),
        ('55555555-5555-4555-8555-555555555555', 'legacy-two', 'legacy-two@example.com', 'Legacy Two')
    `);
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO trips (id, name, room_code, owner_membership_id) VALUES
        ('legacy-financial', 'Legacy financial', 'LEGACYFX', 'legacy-owner'),
        ('legacy-empty', 'Legacy empty', 'LEGACYINR', 'legacy-empty-owner')
    `);
    await client.query(`
      INSERT INTO trip_memberships (id, trip_id, user_id, display_name, role) VALUES
        ('legacy-owner', 'legacy-financial', '44444444-4444-4444-8444-444444444444', 'Legacy One', 'owner'),
        ('legacy-payee', 'legacy-financial', '55555555-5555-4555-8555-555555555555', 'Legacy Two', 'member'),
        ('legacy-empty-owner', 'legacy-empty', '44444444-4444-4444-8444-444444444444', 'Empty owner', 'owner')
    `);
    await client.query(`
      INSERT INTO expenses
        (id, trip_id, paid_by_membership_id, description, total_minor, currency)
      VALUES ('legacy-expense', 'legacy-financial', 'legacy-owner', 'Legacy expense', 100, $1)
    `, [currencies[0]]);
    await client.query(`
      INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor)
      VALUES ('legacy-expense', 'legacy-financial', 'legacy-owner', 100)
    `);
    await client.query('COMMIT');
    await client.query(`
      INSERT INTO payments
        (id, trip_id, payer_membership_id, payee_membership_id, amount_minor, currency, status)
      VALUES ('legacy-payment', 'legacy-financial', 'legacy-owner', 'legacy-payee', 25, $1, 'cancelled')
    `, [currencies[1]]);
  }

  beforeAll(async () => {
    client = await pool.connect();
    legacySchema = `legacy_currency_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    mixedSchema = `mixed_currency_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    await createLegacyFinancialSchema(legacySchema, ['USD', 'USD']);
    await createLegacyFinancialSchema(mixedSchema, ['INR', 'USD']);
  });

  afterAll(async () => {
    try {
      if (client) {
        await client.query(`DROP SCHEMA IF EXISTS ${legacySchema} CASCADE`);
        await client.query(`DROP SCHEMA IF EXISTS ${mixedSchema} CASCADE`);
      }
    } finally {
      if (client) client.release();
      await pool.end();
    }
  });

  it('preserves a cancelled legacy payment and derives its unanimous non-INR trip currency', async () => {
    await client.query(`SET search_path TO ${legacySchema}`);
    await expect(applyPendingMigrations(client as unknown as MigrationDatabase, allMigrationNames.map((id) => ({
      id, sql: readFileSync(join(__dirname, id), 'utf8'),
    })))).resolves.toBeUndefined();
    await expect(client.query(`
      SELECT t.id, t.currency, p.status,
             p.cancelled_at IS NOT NULL AS has_cancelled_at,
             p.cancelled_by_membership_id
        FROM trips t
        LEFT JOIN payments p ON p.trip_id = t.id
       WHERE t.id IN ('legacy-financial', 'legacy-empty')
       ORDER BY t.id
    `)).resolves.toMatchObject({ rows: [
      {
        id: 'legacy-empty', currency: 'INR', status: null,
        has_cancelled_at: false, cancelled_by_membership_id: null,
      },
      {
        id: 'legacy-financial', currency: 'USD', status: 'cancelled',
        has_cancelled_at: true, cancelled_by_membership_id: 'legacy-owner',
      },
    ] });
  });

  it('fails mixed legacy financial currencies with the named diagnostic', async () => {
    await client.query(`SET search_path TO ${mixedSchema}`);
    await expect(applyPendingMigrations(client as unknown as MigrationDatabase, allMigrationNames.map((id) => ({
      id, sql: readFileSync(join(__dirname, id), 'utf8'),
    })))).rejects.toThrow('trip_currency_mismatch');
  });
});
