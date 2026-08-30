import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPendingMigrations, MigrationDatabase } from '../migrate';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runDatabaseTests = testDatabaseUrl ? describe : describe.skip;
const migrations = ['001_initial.sql', '002_preserve_membership_history.sql', '003_authorized_services.sql']
  .map((id) => ({ id, sql: readFileSync(join(__dirname, id), 'utf8') }));

runDatabaseTests('003_authorized_services upgrade', () => {
  const schema = `task_2_upgrade_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await applyPendingMigrations(client as unknown as MigrationDatabase, migrations);
    await client.query("INSERT INTO users (id, firebase_uid, email, name) VALUES ('11111111-1111-4111-8111-111111111111', 'firebase-u1', 'one@example.com', 'One')");
    await client.query('BEGIN');
    await client.query("INSERT INTO trips (id, name, room_code, owner_membership_id) VALUES ('t1', 'Trip one', 'ROOMONE', 'm1')");
    await client.query("INSERT INTO trip_memberships (id, trip_id, user_id, display_name, role) VALUES ('m1', 't1', '11111111-1111-4111-8111-111111111111', 'Owner', 'owner')");
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

  it('supports retry-safe account state and active-only membership names', async () => {
    await expect(client.query(
      "UPDATE users SET account_status = 'deleting', anonymized_at = now() WHERE firebase_uid = 'firebase-u1' RETURNING account_status",
    )).resolves.toMatchObject({ rows: [{ account_status: 'deleting' }] });

    await client.query("INSERT INTO trip_memberships (id, trip_id, display_name, status, left_at) VALUES ('left-1', 't1', 'Sam', 'left', now())");
    await client.query("INSERT INTO trip_memberships (id, trip_id, display_name) VALUES ('active-1', 't1', 'sam')");
    await expect(client.query(
      "INSERT INTO trip_memberships (id, trip_id, display_name) VALUES ('active-2', 't1', 'SAM')",
    )).rejects.toThrow();
  });

  it('tracks payment confirmation and has a composite chat cursor index', async () => {
    await expect(client.query(
      "INSERT INTO payments (id, trip_id, payer_membership_id, payee_membership_id, amount_minor, status) VALUES ('p1', 't1', 'm1', 'active-1', 100, 'invalid')",
    )).rejects.toThrow();
    await expect(client.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'chat_messages_trip_cursor_idx'",
    )).resolves.toMatchObject({ rows: [{ indexdef: expect.stringMatching(/trip_id.*created_at DESC.*id DESC/i) }] });
  });
});
