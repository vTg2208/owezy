import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPendingMigrations, MigrationDatabase } from '../migrate';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runDatabaseTests = testDatabaseUrl ? describe : describe.skip;
const migration = (id: string) => ({ id, sql: readFileSync(join(__dirname, id), 'utf8') });
const priorMigrations = [
  '001_initial.sql',
  '002_preserve_membership_history.sql',
  '003_authorized_services.sql',
  '004_receipt_storage.sql',
].map(migration);

runDatabaseTests('005_owner_continuity upgrade', () => {
  const schema = `owner_continuity_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await applyPendingMigrations(client as unknown as MigrationDatabase, priorMigrations);
    await client.query(`
      INSERT INTO users (id, firebase_uid, email, name) VALUES
        ('11111111-1111-4111-8111-111111111111', 'firebase-u1', 'one@example.com', 'One'),
        ('22222222-2222-4222-8222-222222222222', 'firebase-u2', 'two@example.com', 'Two'),
        ('33333333-3333-4333-8333-333333333333', 'firebase-u3', 'three@example.com', 'Three')
    `);
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO trips (id, name, room_code, owner_membership_id) VALUES
        ('transfer-trip', 'Transfer', 'TRANSFER', 'owner-transfer'),
        ('orphan-trip', 'Orphan', 'ORPHANED', 'owner-orphan')
    `);
    await client.query(`
      INSERT INTO trip_memberships
        (id, trip_id, user_id, display_name, role, status, created_at) VALUES
        ('owner-transfer', 'transfer-trip', '11111111-1111-4111-8111-111111111111', 'Owner', 'owner', 'active', '2026-08-01T00:00:00Z'),
        ('later', 'transfer-trip', '33333333-3333-4333-8333-333333333333', 'Later', 'member', 'active', '2026-08-03T00:00:00Z'),
        ('earlier', 'transfer-trip', '22222222-2222-4222-8222-222222222222', 'Earlier', 'member', 'active', '2026-08-02T00:00:00Z'),
        ('owner-orphan', 'orphan-trip', NULL, 'Legacy owner', 'owner', 'active', '2026-08-01T00:00:00Z')
    `);
    await client.query('COMMIT');
    await applyPendingMigrations(
      client as unknown as MigrationDatabase,
      [...priorMigrations, migration('005_owner_continuity.sql')],
    );
  });

  afterAll(async () => {
    try {
      if (client) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      if (client) client.release();
      await pool.end();
    }
  });

  it('repairs a disconnected legacy owner by explicitly archiving and locking the trip', async () => {
    await expect(client.query(
      `SELECT is_locked, archived_at IS NOT NULL AS archived
         FROM trips WHERE id = 'orphan-trip'`,
    )).resolves.toMatchObject({ rows: [{ is_locked: true, archived: true }] });
  });

  it('transfers a voluntary owner leave to the earliest connected active successor', async () => {
    await expect(client.query(
      `SELECT leave_trip_membership('owner-transfer', false) AS outcome`,
    )).resolves.toMatchObject({ rows: [{ outcome: 'left' }] });
    await expect(client.query(
      `SELECT owner_membership_id FROM trips WHERE id = 'transfer-trip'`,
    )).resolves.toMatchObject({ rows: [{ owner_membership_id: 'earlier' }] });
  });

  it('rejects restoring an archived trip while its linked owner is disconnected', async () => {
    await client.query('BEGIN');
    await client.query(`UPDATE trips SET archived_at = NULL WHERE id = 'orphan-trip'`);
    await expect(client.query('COMMIT')).rejects.toThrow();
    await client.query('ROLLBACK');
  });
});
