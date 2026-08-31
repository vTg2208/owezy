import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPendingMigrations, type MigrationDatabase } from '../db/migrate';
import { PostgresExpenseRepository } from './expenseRepository';
import { PostgresFinancialRepository } from './financialRepository';
import type { TransactionRunner } from './database';
import { ExpenseService } from '../services/expenseService';
import { IdempotencyService } from '../services/idempotencyService';
import { InviteService } from '../services/inviteService';
import { PaymentService } from '../services/paymentService';
import { cleanupExpiredReceipts, PostgresReceiptCleanupRepository } from '../jobs/receiptCleanup';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runDatabaseTests = testDatabaseUrl ? describe : describe.skip;

runDatabaseTests('production financial workflows', () => {
  const schema = `financial_workflows_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  let client: PoolClient;
  let counter = 0;
  const id = (prefix: string) => () => `${prefix}-${++counter}`;
  const transaction: TransactionRunner = async (work) => {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  };

  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    const migrations = [
      '001_initial.sql', '002_preserve_membership_history.sql',
      '003_authorized_services.sql', '004_receipt_storage.sql',
      '005_owner_continuity.sql', '006_production_hardening.sql',
    ].map((migration) => ({
      id: migration,
      sql: readFileSync(join(__dirname, '../db/migrations', migration), 'utf8'),
    }));
    await applyPendingMigrations(client as unknown as MigrationDatabase, migrations);
    await client.query(`
      INSERT INTO users (id, firebase_uid, email, name) VALUES
        ('11111111-1111-4111-8111-111111111111', 'owner-uid', 'owner@example.com', 'Owner'),
        ('22222222-2222-4222-8222-222222222222', 'payee-uid', 'payee@example.com', 'Payee'),
        ('33333333-3333-4333-8333-333333333333', 'guest-uid', 'guest@example.com', 'Guest')
    `);
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO trips (id, name, room_code, owner_membership_id)
      VALUES ('trip-1', 'Goa', 'GOA123', 'owner-member')
    `);
    await client.query(`
      INSERT INTO trip_memberships (id, trip_id, user_id, display_name, role) VALUES
        ('owner-member', 'trip-1', '11111111-1111-4111-8111-111111111111', 'Owner', 'owner'),
        ('payee-member', 'trip-1', '22222222-2222-4222-8222-222222222222', 'Payee', 'member')
    `);
    await client.query('COMMIT');
  });

  afterAll(async () => {
    try {
      if (client) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      client?.release();
      await pool.end();
    }
  });

  it('replays payment creation and lets only the recipient confirm once', async () => {
    const repository = new PostgresFinancialRepository(client, transaction, id('audit'));
    const payments = new PaymentService(repository, () => 'payment-1');
    const idempotency = new IdempotencyService(transaction, () => 'idempotency-1');
    let workCalls = 0;
    const work = async (database: any) => {
      workCalls += 1;
      const payment = await payments.create('owner-uid', 'trip-1', {
        payeeMembershipId: 'payee-member', amount: '10.00', note: 'Dinner',
      }, database);
      return { status: 201, body: { id: payment.id, status: payment.status } };
    };

    expect((await idempotency.execute(
      'owner-member', 'payment.create', 'payment-key', { amount: '10.00' }, work,
    )).replayed).toBe(false);
    expect((await idempotency.execute(
      'owner-member', 'payment.create', 'payment-key', { amount: '10.00' }, work,
    )).replayed).toBe(true);
    expect(workCalls).toBe(1);
    await expect(payments.confirm('owner-uid', 'trip-1', 'payment-1'))
      .rejects.toMatchObject({ status: 403 });
    await expect(payments.confirm('payee-uid', 'trip-1', 'payment-1'))
      .resolves.toMatchObject({ status: 'confirmed' });
    await expect(payments.confirm('payee-uid', 'trip-1', 'payment-1'))
      .rejects.toMatchObject({ status: 409 });
    await expect(client.query(`SELECT count(*)::int AS count FROM payments WHERE id = 'payment-1'`))
      .resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('corrects and voids expenses without rewriting history', async () => {
    const repository = new PostgresExpenseRepository(client, transaction, id('audit-expense'));
    const expenses = new ExpenseService(repository, id('expense'));
    const created = await expenses.createExpense('owner-uid', 'trip-1', {
      description: 'Original meal', amount: '20.00', splitType: 'equal',
    });
    const corrected = await expenses.correctExpense(
      'owner-uid', 'trip-1', created.expenseId, 1,
      { description: 'Corrected meal', amount: '18.00', splitType: 'equal' },
    );

    expect(corrected).toMatchObject({ version: 2, status: 'active' });
    await expect(expenses.correctExpense(
      'owner-uid', 'trip-1', created.expenseId, 1,
      { description: 'Stale', amount: '17.00', splitType: 'equal' },
    )).rejects.toMatchObject({ status: 409 });
    await expect(expenses.voidExpense(
      'owner-uid', 'trip-1', corrected.expenseId, 2,
    )).resolves.toMatchObject({ status: 'voided' });
    await expect(client.query(
      `SELECT version, status FROM expenses WHERE expense_key = $1 ORDER BY version`,
      [created.expenseId],
    )).resolves.toMatchObject({ rows: [
      { version: 1, status: 'voided' },
      { version: 2, status: 'voided' },
    ] });
  });

  it('stores only an invite hash and makes acceptance effect-idempotent', async () => {
    const repository = new PostgresFinancialRepository(client, transaction, id('audit-invite'));
    const invites = new InviteService(
      repository, () => 'invite-1', () => 'raw-secret-token',
      () => new Date(),
    );
    await invites.create('owner-uid', 'trip-1', { email: 'guest@example.com', expiresInHours: 24 });
    const first = await invites.accept(
      { uid: 'guest-uid', email: 'guest@example.com', name: 'Guest' }, 'raw-secret-token',
    );
    const replay = await invites.accept(
      { uid: 'guest-uid', email: 'guest@example.com', name: 'Guest' }, 'raw-secret-token',
    );

    expect(replay).toEqual(first);
    const stored = await client.query(`SELECT token_hash FROM trip_invites WHERE id = 'invite-1'`);
    expect(stored.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0].token_hash).not.toContain('raw-secret-token');
  });

  it('locks, removes, and conditionally deletes expired pending receipts', async () => {
    await client.query(`
      INSERT INTO receipts
        (id, trip_id, uploaded_by_membership_id, storage_key, content_type,
         byte_size, checksum_sha256, status, pending_expires_at)
      VALUES
        ('expired-receipt', 'trip-1', 'owner-member', 'expired-receipt.png', 'image/png',
         8, repeat('a', 64), 'pending', now() - interval '1 hour')
    `);
    const removed: string[] = [];
    const result = await cleanupExpiredReceipts(
      { dryRun: false, limit: 10 },
      {
        repository: new PostgresReceiptCleanupRepository(transaction),
        storage: {
          async write() { return { storageKey: '' }; },
          async read() { return Buffer.alloc(0); },
          async remove(key) { removed.push(key); },
        },
      },
    );

    expect(result).toEqual({ scanned: 1, removed: 1, failed: 0 });
    expect(removed).toEqual(['expired-receipt.png']);
    await expect(client.query(`SELECT id FROM receipts WHERE id = 'expired-receipt'`))
      .resolves.toMatchObject({ rowCount: 0 });
  });
});
