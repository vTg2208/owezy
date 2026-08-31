import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPendingMigrations, loadMigrations, type MigrationDatabase } from '../migrate';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runDatabaseTests = testDatabaseUrl ? describe : describe.skip;

runDatabaseTests('007 security boundaries migration', () => {
  const schema = `security_boundaries_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await applyPendingMigrations(
      client as unknown as MigrationDatabase,
      loadMigrations().filter((migration) => migration.id < '007_'),
    );
    await client.query(`
      INSERT INTO users (id, firebase_uid, email, name)
      VALUES ('11111111-1111-4111-8111-111111111111', 'owner-uid', 'owner@example.com', 'Owner')
    `);
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO trips (id, name, room_code, owner_membership_id)
      VALUES ('trip-1', 'Goa', 'GOA123', 'owner-member')
    `);
    await client.query(`
      INSERT INTO trip_memberships (id, trip_id, user_id, display_name, role)
      VALUES ('owner-member', 'trip-1', '11111111-1111-4111-8111-111111111111', 'Owner', 'owner')
    `);
    await client.query('COMMIT');
    await client.query(`
      INSERT INTO audit_events
        (id, actor_membership_id, action, entity_type, entity_id, metadata)
      VALUES
        ('audit-1', 'owner-member', 'invite.created', 'invite', 'invite-1',
         '{"email":"private@example.com","expiresAt":"2026-09-01T00:00:00.000Z"}')
    `);
  });

  afterAll(async () => {
    try {
      if (client) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      client?.release();
      await pool.end();
    }
  });

  it('scrubs historical invite email metadata and enforces bounded stored text', async () => {
    await applyPendingMigrations(client as unknown as MigrationDatabase, [{
      id: '007_security_boundaries.sql',
      sql: readFileSync(join(__dirname, '007_security_boundaries.sql'), 'utf8'),
    }]);

    await expect(client.query(`SELECT metadata FROM audit_events WHERE id = 'audit-1'`))
      .resolves.toMatchObject({ rows: [{ metadata: { expiresAt: '2026-09-01T00:00:00.000Z' } }] });
    await expect(client.query(`UPDATE audit_events SET metadata = '{}' WHERE id = 'audit-1'`))
      .rejects.toThrow('audit events are immutable');
    await expect(client.query(
      `INSERT INTO users (id, firebase_uid, email, name) VALUES ($1, $2, $3, $4)`,
      ['22222222-2222-4222-8222-222222222222', 'oversized-uid', 'valid@example.com', 'N'.repeat(101)],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(client.query(
      `INSERT INTO chat_messages (id, trip_id, membership_id, message) VALUES ($1, $2, $3, $4)`,
      ['message-1', 'trip-1', 'owner-member', 'M'.repeat(501)],
    )).rejects.toMatchObject({ code: '23514' });
  });
});
