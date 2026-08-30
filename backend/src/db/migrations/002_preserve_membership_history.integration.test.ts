import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPendingMigrations, type MigrationDatabase } from '../migrate';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runDatabaseTests = testDatabaseUrl ? describe : describe.skip;

const currentInitialSql = readFileSync(join(__dirname, '001_initial.sql'), 'utf8');
const legacyInitialSql = currentInitialSql
  .replace('REFERENCES trips(id) ON DELETE RESTRICT', 'REFERENCES trips(id) ON DELETE CASCADE')
  .replace(
    "  RAISE EXCEPTION 'trip memberships are historical records and cannot be deleted';\n  RETURN OLD;",
    "  IF pg_trigger_depth() = 1 THEN\n    RAISE EXCEPTION 'trip memberships are historical records and cannot be deleted';\n  END IF;\n  RETURN OLD;",
  );
const preserveHistorySql = readFileSync(join(__dirname, '002_preserve_membership_history.sql'), 'utf8');

runDatabaseTests('002_preserve_membership_history upgrade', () => {
  const schema = `task_1_upgrade_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await applyPendingMigrations(client as unknown as MigrationDatabase, [
      { id: '001_initial.sql', sql: legacyInitialSql },
    ]);

    await client.query('BEGIN');
    await client.query("INSERT INTO users (id, firebase_uid, email, name) VALUES ('11111111-1111-4111-8111-111111111111', 'firebase-u1', 'one@example.com', 'One')");
    await client.query("INSERT INTO trips (id, name, room_code, owner_membership_id) VALUES ('t1', 'Trip one', 'ROOMONE', 'm1')");
    await client.query("INSERT INTO trip_memberships (id, trip_id, user_id, display_name, role) VALUES ('m1', 't1', '11111111-1111-4111-8111-111111111111', 'One', 'owner')");
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

  it('repairs the old 001 deletion behavior with a recorded 002 migration', async () => {
    await client.query('BEGIN');
    await client.query("DELETE FROM trips WHERE id = 't1'");
    await expect(client.query("SELECT id FROM trip_memberships WHERE trip_id = 't1'"))
      .resolves.toMatchObject({ rows: [] });
    await client.query('ROLLBACK');

    await applyPendingMigrations(client as unknown as MigrationDatabase, [
      { id: '001_initial.sql', sql: currentInitialSql },
      { id: '002_preserve_membership_history.sql', sql: preserveHistorySql },
    ]);

    await expect(client.query("DELETE FROM trips WHERE id = 't1'"))
      .rejects.toThrow();
    await expect(client.query("SELECT id FROM trip_memberships WHERE trip_id = 't1'"))
      .resolves.toMatchObject({ rows: [{ id: 'm1' }] });

    await applyPendingMigrations(client as unknown as MigrationDatabase, [
      { id: '001_initial.sql', sql: currentInitialSql },
      { id: '002_preserve_membership_history.sql', sql: preserveHistorySql },
    ]);
    await expect(client.query('SELECT id FROM schema_migrations ORDER BY id'))
      .resolves.toMatchObject({ rows: [{ id: '001_initial.sql' }, { id: '002_preserve_membership_history.sql' }] });
  });
});
