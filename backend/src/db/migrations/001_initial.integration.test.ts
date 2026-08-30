import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runDatabaseTests = testDatabaseUrl ? describe : describe.skip;

runDatabaseTests('001_initial migration', () => {
  const schema = `task_1_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(readFileSync(join(__dirname, '001_initial.sql'), 'utf8'));

    await client.query('BEGIN');
    await client.query("INSERT INTO users (id, firebase_uid, email, name) VALUES ('11111111-1111-4111-8111-111111111111', 'firebase-u1', 'one@example.com', 'One'), ('22222222-2222-4222-8222-222222222222', 'firebase-u2', 'two@example.com', 'Two'), ('33333333-3333-4333-8333-333333333333', 'firebase-u3', 'three@example.com', 'Three'), ('44444444-4444-4444-8444-444444444444', 'firebase-u4', 'four@example.com', 'Four')");
    await client.query("INSERT INTO trips (id, name, room_code, owner_membership_id) VALUES ('t1', 'Trip one', 'ROOMONE', 'm1'), ('t2', 'Trip two', 'ROOMTWO', 'm3')");
    await client.query("INSERT INTO trip_memberships (id, trip_id, user_id, display_name, role) VALUES ('m1', 't1', '11111111-1111-4111-8111-111111111111', 'One', 'owner'), ('m2', 't1', '22222222-2222-4222-8222-222222222222', 'Two', 'member'), ('m4', 't1', '44444444-4444-4444-8444-444444444444', 'Four', 'member'), ('m3', 't2', '33333333-3333-4333-8333-333333333333', 'Three', 'owner')");
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

  it('uses UUID IDs with a unique non-null Firebase identity mapping', async () => {
    const identity = await client.query("SELECT pg_typeof(id)::text AS id_type, firebase_uid FROM users WHERE firebase_uid = 'firebase-u1'");
    expect(identity.rows[0]).toEqual({ id_type: 'uuid', firebase_uid: 'firebase-u1' });

    await expect(client.query("INSERT INTO users (id, email, name) VALUES ('55555555-5555-4555-8555-555555555555', 'missing-firebase@example.com', 'Missing Firebase UID')"))
      .rejects.toThrow();
    await expect(client.query("INSERT INTO users (id, firebase_uid, email, name) VALUES ('55555555-5555-4555-8555-555555555555', 'firebase-u1', 'duplicate@example.com', 'Duplicate')"))
      .rejects.toThrow();
  });

  it('enforces same-trip foreign keys and unique memberships', async () => {
    await expect(client.query("INSERT INTO trip_memberships (id, trip_id, user_id, display_name) VALUES ('m5', 't1', '22222222-2222-4222-8222-222222222222', 'Duplicate')"))
      .rejects.toThrow();

    await client.query('BEGIN');
    await client.query("INSERT INTO expenses (id, trip_id, paid_by_membership_id, description, total_minor) VALUES ('e1', 't1', 'm1', 'Dinner', 100)");
    await client.query("INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor) VALUES ('e1', 't2', 'm3', 100)");
    await expect(client.query('COMMIT')).rejects.toThrow();
    await client.query('ROLLBACK');
  });

  it('preserves historical memberships through lifecycle and anonymization support', async () => {
    await expect(client.query("DELETE FROM trip_memberships WHERE id = 'm2'"))
      .rejects.toThrow();

    await client.query("SELECT leave_trip_membership('m4')");
    await client.query("DELETE FROM users WHERE id = '22222222-2222-4222-8222-222222222222'");
    const result = await client.query("SELECT user_id, status, anonymized_at, display_name FROM trip_memberships WHERE id = 'm2'");
    const departed = await client.query("SELECT status, left_at FROM trip_memberships WHERE id = 'm4'");

    expect(result.rows[0]).toMatchObject({ user_id: null, status: 'anonymized' });
    expect(result.rows[0].anonymized_at).not.toBeNull();
    expect(result.rows[0].display_name).toContain('Former member');
    expect(departed.rows[0]).toMatchObject({ status: 'left' });
    expect(departed.rows[0].left_at).not.toBeNull();
  });

  it('enforces positive amounts, unique split members, and the deferred split total', async () => {
    await expect(client.query("INSERT INTO payments (id, trip_id, payer_membership_id, payee_membership_id, amount_minor) VALUES ('p1', 't1', 'm1', 'm2', 0)"))
      .rejects.toThrow();

    await client.query('BEGIN');
    await client.query("INSERT INTO expenses (id, trip_id, paid_by_membership_id, description, total_minor) VALUES ('e2', 't1', 'm1', 'Taxi', 100)");
    await client.query("INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor) VALUES ('e2', 't1', 'm2', 99)");
    await expect(client.query('COMMIT')).rejects.toThrow();
    await client.query('ROLLBACK');

    await client.query('BEGIN');
    await client.query("INSERT INTO expenses (id, trip_id, paid_by_membership_id, description, total_minor) VALUES ('e3', 't1', 'm1', 'Lunch', 100)");
    await client.query("INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor) VALUES ('e3', 't1', 'm2', 100)");
    await expect(client.query("INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor) VALUES ('e3', 't1', 'm2', 1)"))
      .rejects.toThrow();
    await client.query('ROLLBACK');
  });

  it('checks both expenses when a split is moved between expenses', async () => {
    await client.query('BEGIN');
    await client.query("INSERT INTO expenses (id, trip_id, paid_by_membership_id, description, total_minor) VALUES ('e4', 't1', 'm1', 'Fuel', 100), ('e5', 't1', 'm1', 'Hotel', 200)");
    await client.query("INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor) VALUES ('e4', 't1', 'm1', 100), ('e5', 't1', 'm2', 100), ('e5', 't1', 'm4', 100)");
    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query("UPDATE expenses SET total_minor = 300 WHERE id = 'e5'");
    await client.query("UPDATE expense_splits SET expense_id = 'e5' WHERE expense_id = 'e4' AND membership_id = 'm1'");
    await expect(client.query('COMMIT')).rejects.toThrow();
    await client.query('ROLLBACK');
  });
});
