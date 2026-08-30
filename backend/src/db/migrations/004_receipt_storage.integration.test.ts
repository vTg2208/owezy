import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPendingMigrations, MigrationDatabase } from '../migrate';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runDatabaseTests = testDatabaseUrl ? describe : describe.skip;
const migrations = [
  '001_initial.sql',
  '002_preserve_membership_history.sql',
  '003_authorized_services.sql',
  '004_receipt_storage.sql',
].map((id) => ({ id, sql: readFileSync(join(__dirname, id), 'utf8') }));

runDatabaseTests('004_receipt_storage upgrade', () => {
  const schema = `task_3_receipts_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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

  it('stores metadata-complete pending receipts before an expense exists', async () => {
    const pendingExpiresAt = new Date('2026-09-01T00:00:00.000Z');
    await expect(client.query(
      `INSERT INTO receipts
         (id, trip_id, uploaded_by_membership_id, storage_key, content_type,
          byte_size, checksum_sha256, status, pending_expires_at)
       VALUES ('r1', 't1', 'm1', '2026-08/r1.png', 'image/png', 8,
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               'pending', $1)
       RETURNING expense_id, status, pending_expires_at`,
      [pendingExpiresAt],
    )).resolves.toMatchObject({ rows: [{ expense_id: null, status: 'pending', pending_expires_at: pendingExpiresAt }] });
  });

  it('enforces receipt lifecycle and metadata constraints', async () => {
    await expect(client.query(
      `INSERT INTO receipts
         (id, trip_id, uploaded_by_membership_id, storage_key, content_type,
          byte_size, checksum_sha256, status, pending_expires_at)
       VALUES ('bad-size', 't1', 'm1', 'bad-size.png', 'image/png', 0,
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               'pending', now())`,
    )).rejects.toThrow();

    await expect(client.query(
      `INSERT INTO receipts
         (id, trip_id, uploaded_by_membership_id, storage_key, content_type,
          byte_size, checksum_sha256, status, pending_expires_at)
       VALUES ('bad-checksum', 't1', 'm1', 'bad-checksum.png', 'image/png', 8,
               'not-a-checksum', 'pending', now())`,
    )).rejects.toThrow();

    await expect(client.query(
      `UPDATE receipts
          SET status = 'attached', pending_expires_at = NULL, attached_at = now()
        WHERE id = 'r1'`,
    )).rejects.toThrow();
  });

  it('preserves one restart-safe legacy mapping per source ID', async () => {
    await client.query(
      `INSERT INTO legacy_id_mappings (entity_type, legacy_id, postgres_id)
       VALUES ('user', 'firebase-u1', '11111111-1111-4111-8111-111111111111')`,
    );
    await expect(client.query(
      `INSERT INTO legacy_id_mappings (entity_type, legacy_id, postgres_id)
       VALUES ('user', 'firebase-u1', '22222222-2222-4222-8222-222222222222')`,
    )).rejects.toThrow();
  });
});
