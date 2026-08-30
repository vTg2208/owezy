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
    await client.query("INSERT INTO users (id, email, name) VALUES ('u1', 'one@example.com', 'One'), ('u2', 'two@example.com', 'Two'), ('u3', 'three@example.com', 'Three')");
    await client.query("INSERT INTO trips (id, name, room_code, owner_membership_id) VALUES ('t1', 'Trip one', 'ROOMONE', 'm1'), ('t2', 'Trip two', 'ROOMTWO', 'm3')");
    await client.query("INSERT INTO trip_memberships (id, trip_id, user_id, display_name, role) VALUES ('m1', 't1', 'u1', 'One', 'owner'), ('m2', 't1', 'u2', 'Two', 'member'), ('m3', 't2', 'u3', 'Three', 'owner')");
    await client.query('COMMIT');
  });

  afterAll(async () => {
    if (client) client.release();
    await pool.end();
  });

  it('enforces same-trip foreign keys and unique memberships', async () => {
    await expect(client.query("INSERT INTO trip_memberships (id, trip_id, user_id, display_name) VALUES ('m4', 't1', 'u2', 'Duplicate')"))
      .rejects.toThrow();

    await client.query('BEGIN');
    await client.query("INSERT INTO expenses (id, trip_id, paid_by_membership_id, description, total_minor) VALUES ('e1', 't1', 'm1', 'Dinner', 100)");
    await client.query("INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor) VALUES ('e1', 't2', 'm3', 100)");
    await expect(client.query('COMMIT')).rejects.toThrow();
    await client.query('ROLLBACK');
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
});
