import { describe, expect, it } from 'vitest';
import { DisabledReceiptStorage } from '../storage/receiptStorage';
import {
  LegacySnapshot,
  MigrationIssue,
  MigrationTarget,
  PostgresMigrationTarget,
  loadLegacySnapshot,
  parseMigrationCliOptions,
  executeMigration,
  transformLegacySnapshot,
  verifyMigration,
} from './migrate-mongo-to-postgres';
import { ReceiptStorage, SupportedReceiptContentType } from '../storage/receiptStorage';

function validSnapshot(): LegacySnapshot {
  return {
    users: [
      { _id: 'firebase-u1', email: 'one@example.com', name: 'One', created_at: '2026-08-01T00:00:00.000Z' },
      { _id: 'firebase-u2', email: 'two@example.com', name: 'Two', created_at: '2026-08-02T00:00:00.000Z' },
    ],
    trips: [{
      _id: 'trip-1', name: 'Goa', room_code: 'ABC123', admin_id: 'member-1',
      is_locked: false, created_at: '2026-08-03T00:00:00.000Z', updated_at: '2026-08-04T00:00:00.000Z',
    }],
    members: [
      { _id: 'member-1', trip_id: 'trip-1', name: 'One', user_id: 'firebase-u1', is_admin: true, created_at: '2026-08-03T00:00:00.000Z' },
      { _id: 'member-2', trip_id: 'trip-1', name: 'Two', user_id: 'firebase-u2', is_admin: false, created_at: '2026-08-03T00:01:00.000Z' },
    ],
    expenses: [{
      _id: 'expense-1', trip_id: 'trip-1', paid_by: 'member-1', description: 'Meal',
      amount: '10.01', split_type: 'custom',
      splits: [{ member_id: 'member-1', amount: '5.01' }, { member_id: 'member-2', amount: '5.00' }],
      receipt_url: 'data:image/png;base64,iVBORw0KGgo=',
      created_at: '2026-08-05T00:00:00.000Z',
    }],
    messages: [{
      _id: 'message-1', trip_id: 'trip-1', member_id: 'member-2', message: 'Thanks',
      created_at: '2026-08-05T00:01:00.000Z',
    }],
  };
}

describe('transformLegacySnapshot', () => {
  it('preserves legacy text IDs, deterministically maps Firebase users, and converts exact minor units', () => {
    const plan = transformLegacySnapshot(validSnapshot());

    expect(plan.issues).toEqual([]);
    expect(plan.users).toEqual([
      {
        id: '97ba9973-3fc1-47e1-a57b-7901988652f4', legacyId: 'firebase-u1',
        firebaseUid: 'firebase-u1', email: 'one@example.com', name: 'One',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        id: 'a5a06686-d8d1-4782-9618-33d9708b0e93', legacyId: 'firebase-u2',
        firebaseUid: 'firebase-u2', email: 'two@example.com', name: 'Two',
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
      },
    ]);
    expect(plan.trips[0]).toMatchObject({ id: 'trip-1', ownerMembershipId: 'member-1' });
    expect(plan.memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'member-2', tripId: 'trip-1', userId: 'a5a06686-d8d1-4782-9618-33d9708b0e93', role: 'member',
      }),
    ]));
    expect(plan.expenses).toEqual([expect.objectContaining({
      id: 'expense-1', tripId: 'trip-1', paidByMembershipId: 'member-1', totalMinor: 1001n,
    })]);
    expect(plan.expenseSplits).toEqual([
      { expenseId: 'expense-1', tripId: 'trip-1', membershipId: 'member-1', amountMinor: 501n },
      { expenseId: 'expense-1', tripId: 'trip-1', membershipId: 'member-2', amountMinor: 500n },
    ]);
    expect(plan.mappings).toEqual(expect.arrayContaining([
      { entityType: 'user', legacyId: 'firebase-u1', postgresId: '97ba9973-3fc1-47e1-a57b-7901988652f4' },
      { entityType: 'expense', legacyId: 'expense-1', postgresId: 'expense-1' },
    ]));
  });

  it('extracts supported data-URL receipt bytes and metadata without putting bytes in SQL records', () => {
    const plan = transformLegacySnapshot(validSnapshot());

    expect(plan.receipts).toEqual([{
      id: 'receipt-c950f3315cf046c6fe00c738',
      legacyId: 'expense-1:receipt',
      expenseId: 'expense-1',
      tripId: 'trip-1',
      uploadedByMembershipId: 'member-1',
      contentType: 'image/png',
      byteSize: 8,
      checksumSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      createdAt: new Date('2026-08-05T00:00:00.000Z'),
    }]);
    expect(plan.receipts[0]).not.toHaveProperty('storageKey');
  });

  it('reports malformed receipts and orphaned records instead of silently accepting them', () => {
    const snapshot = validSnapshot();
    snapshot.expenses.push(
      {
        _id: 'bad-receipt', trip_id: 'trip-1', paid_by: 'member-1', description: 'Taxi', amount: 5,
        split_type: 'equal', splits: [{ member_id: 'member-1', amount: 5 }],
        receipt_url: 'data:image/png;base64,%%%not-base64%%%', created_at: '2026-08-06T00:00:00.000Z',
      },
      {
        _id: 'orphan-expense', trip_id: 'trip-1', paid_by: 'missing-member', description: 'Unknown', amount: 5,
        split_type: 'equal', splits: [{ member_id: 'member-1', amount: 5 }], created_at: '2026-08-06T00:00:00.000Z',
      },
    );
    snapshot.messages.push({
      _id: 'orphan-message', trip_id: 'trip-1', member_id: 'missing-member', message: 'Lost',
      created_at: '2026-08-06T00:00:00.000Z',
    });

    const plan = transformLegacySnapshot(snapshot);

    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_receipt_data_url', entity: 'receipt', legacyId: 'bad-receipt:receipt' }),
      expect.objectContaining({ code: 'orphan_expense_payer', entity: 'expense', legacyId: 'orphan-expense' }),
      expect.objectContaining({ code: 'orphan_message_member', entity: 'message', legacyId: 'orphan-message' }),
    ]));
    expect(plan.receipts.some(({ legacyId }) => legacyId === 'bad-receipt:receipt')).toBe(false);
    expect(plan.expenses.some(({ id }) => id === 'orphan-expense')).toBe(false);
    expect(plan.messages.some(({ id }) => id === 'orphan-message')).toBe(false);
    expect(plan.sourceCounts).toMatchObject({ expenses: 3, receipts: 2, messages: 2 });
  });

  it('reports duplicate IDs and excludes expenses whose split totals do not match', () => {
    const snapshot = validSnapshot();
    snapshot.users.push({
      _id: 'firebase-u1', email: 'duplicate@example.com', name: 'Duplicate',
      created_at: '2026-08-07T00:00:00.000Z',
    });
    snapshot.expenses.push({
      _id: 'mismatch', trip_id: 'trip-1', paid_by: 'member-1', description: 'Mismatch', amount: 10,
      split_type: 'custom', splits: [
        { member_id: 'member-1', amount: 4 }, { member_id: 'member-2', amount: 5 },
      ], created_at: '2026-08-07T00:00:00.000Z',
    });

    const plan = transformLegacySnapshot(snapshot);

    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_legacy_id', entity: 'user', legacyId: 'firebase-u1' }),
      expect.objectContaining({ code: 'split_total_mismatch', entity: 'expense', legacyId: 'mismatch' }),
    ]));
    expect(plan.expenses.some(({ id }) => id === 'mismatch')).toBe(false);
  });

  it('reports a record with a missing creation date instead of inventing migration time', () => {
    const snapshot = validSnapshot();
    snapshot.members.push({
      _id: 'missing-date', trip_id: 'trip-1', name: 'No date', is_admin: false,
    });

    const plan = transformLegacySnapshot(snapshot);

    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_membership', legacyId: 'missing-date' }),
    ]));
    expect(plan.memberships.some(({ id }) => id === 'missing-date')).toBe(false);
  });
});

describe('verifyMigration', () => {
  it('verifies successful counts, references, split totals, and zero-sum trip balances', () => {
    const verification = verifyMigration(transformLegacySnapshot(validSnapshot()));

    expect(verification.valid).toBe(true);
    expect(verification.issues).toEqual([]);
    expect(verification.counts).toEqual({
      source: { users: 2, trips: 1, memberships: 2, expenses: 1, expenseSplits: 2, receipts: 1, messages: 1 },
      transformed: { users: 2, trips: 1, memberships: 2, expenses: 1, expenseSplits: 2, receipts: 1, messages: 1 },
    });
  });

  it('detects split-total and non-zero trip ledger mutations independently', () => {
    const plan = transformLegacySnapshot(validSnapshot());
    plan.expenseSplits[0].amountMinor = 500n;

    const verification = verifyMigration(plan);

    expect(verification.valid).toBe(false);
    expect(verification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'split_total_mismatch', legacyId: 'expense-1' }),
      expect.objectContaining({ code: 'trip_balance_nonzero', legacyId: 'trip-1' }),
    ]));
  });

  it('requires exactly one owner membership per transformed trip', () => {
    const snapshot = validSnapshot();
    snapshot.members.push({
      _id: 'extra-owner', trip_id: 'trip-1', name: 'Extra owner', is_admin: true,
      created_at: '2026-08-03T00:02:00.000Z',
    });

    const verification = verifyMigration(transformLegacySnapshot(snapshot));

    expect(verification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'trip_owner_count_invalid', legacyId: 'trip-1' }),
    ]));
  });
});

class RecordingTarget implements MigrationTarget {
  writes = 0;
  verifications = 0;
  verificationIssues: MigrationIssue[] = [];

  async apply() {
    this.writes += 1;
  }

  async verify() {
    this.verifications += 1;
    return this.verificationIssues;
  }
}

describe('executeMigration', () => {
  it('performs a verified dry-run without external writes', async () => {
    const target = new RecordingTarget();

    const result = await executeMigration(transformLegacySnapshot(validSnapshot()), {
      dryRun: true,
      target,
      storage: new DisabledReceiptStorage(),
    });

    expect(result).toMatchObject({ ok: true, dryRun: true });
    expect(target.writes).toBe(0);
    expect(target.verifications).toBe(0);
  });

  it('refuses all writes when transformation or preflight verification reports an issue', async () => {
    const snapshot = validSnapshot();
    snapshot.expenses[0].paid_by = 'missing';
    const target = new RecordingTarget();

    const result = await executeMigration(transformLegacySnapshot(snapshot), {
      dryRun: false,
      target,
      storage: new DisabledReceiptStorage(),
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'orphan_expense_payer' }),
    ]));
    expect(target.writes).toBe(0);
  });

  it('reports post-write database verification failures', async () => {
    const target = new RecordingTarget();
    target.verificationIssues = [{
      code: 'database_count_mismatch', entity: 'migration', legacyId: 'expense',
      message: 'Expected 1 expense mapping, found 0',
    }];

    const result = await executeMigration(transformLegacySnapshot(validSnapshot()), {
      dryRun: false,
      target,
      storage: new DisabledReceiptStorage(),
    });

    expect(result).toMatchObject({ ok: false, dryRun: false });
    expect(target.writes).toBe(1);
    expect(target.verifications).toBe(1);
    expect(result.issues).toEqual(target.verificationIssues);
  });
});

class RecordingStorage implements ReceiptStorage {
  writes = 0;
  readonly objects = new Map<string, Buffer>();

  async write(bytes: Buffer, _contentType: SupportedReceiptContentType) {
    this.writes += 1;
    const storageKey = `migration-${this.writes}.png`;
    this.objects.set(storageKey, Buffer.from(bytes));
    return { storageKey };
  }

  async read(storageKey: string) {
    return this.objects.get(storageKey) ?? Buffer.alloc(0);
  }

  async remove(storageKey: string) {
    this.objects.delete(storageKey);
  }
}

describe('PostgresMigrationTarget', () => {
  it('uses idempotent SQL, per-trip transactions, and skips already-mapped receipt objects on restart', async () => {
    const statements: Array<{ sql: string; values?: unknown[]; inTransaction: boolean }> = [];
    let transactionOpen = false;
    let transactionCalls = 0;
    let receiptMapped = false;
    const database = {
      async query(text: string, values?: unknown[]) {
        const sql = text.replace(/\s+/g, ' ').trim();
        statements.push({ sql, values, inTransaction: transactionOpen });
        if (sql.startsWith('INSERT INTO users')) {
          return { rows: [{ id: values?.[0] }], rowCount: 1 };
        }
        if (sql.startsWith('SELECT postgres_id FROM legacy_id_mappings')) {
          return receiptMapped
            ? { rows: [{ postgres_id: 'receipt-c950f3315cf046c6fe00c738' }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (
          sql.startsWith('INSERT INTO legacy_id_mappings')
          && values?.[0] === 'receipt'
        ) {
          receiptMapped = true;
        }
        return { rows: [], rowCount: 1 };
      },
    };
    const transaction = async <T>(work: (executor: typeof database) => Promise<T>) => {
      transactionCalls += 1;
      transactionOpen = true;
      try {
        return await work(database);
      } finally {
        transactionOpen = false;
      }
    };
    const target = new PostgresMigrationTarget(database, transaction);
    const storage = new RecordingStorage();
    const plan = transformLegacySnapshot(validSnapshot());

    await target.apply(plan, storage);
    await target.apply(plan, storage);

    expect(storage.writes).toBe(1);
    expect(transactionCalls).toBe(4);
    expect(statements.filter(({ sql }) => sql.startsWith('INSERT INTO receipts')))
      .toEqual([expect.objectContaining({ inTransaction: true })]);
    expect(statements.filter(({ sql }) => sql.startsWith('INSERT INTO'))
      .every(({ sql }) => sql.includes('ON CONFLICT'))).toBe(true);
  });

  it('verifies database counts, references, split totals, and zero-sum balances', async () => {
    const plan = transformLegacySnapshot(validSnapshot());
    const database = {
      async query(text: string) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.includes('AS expense_splits') && sql.includes('AS users')) {
          return {
            rows: [{
              users: '2', trips: '1', memberships: '2', expenses: '1',
              expense_splits: '2', receipts: '1', messages: '1',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('AS orphan_count')) return { rows: [{ orphan_count: '0' }], rowCount: 1 };
        if (sql.includes('HAVING sum(s.amount_minor)')) return { rows: [], rowCount: 0 };
        if (sql.includes('HAVING sum(delta)')) return { rows: [], rowCount: 0 };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await expect(target.verify(plan)).resolves.toEqual([]);
  });

  it('reports a mismatched migrated database count', async () => {
    const plan = transformLegacySnapshot(validSnapshot());
    const database = {
      async query(text: string) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.includes('AS expense_splits') && sql.includes('AS users')) {
          return {
            rows: [{
              users: '2', trips: '1', memberships: '2', expenses: '0',
              expense_splits: '2', receipts: '1', messages: '1',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('AS orphan_count')) return { rows: [{ orphan_count: '0' }], rowCount: 1 };
        if (sql.includes('HAVING sum(s.amount_minor)')) return { rows: [], rowCount: 0 };
        if (sql.includes('HAVING sum(delta)')) return { rows: [], rowCount: 0 };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await expect(target.verify(plan)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'database_count_mismatch', legacyId: 'expenses' }),
    ]));
  });
});

describe('migration CLI boundaries', () => {
  it('loads the exact legacy Mongoose collections through the MongoDB source boundary', async () => {
    const requestedCollections: string[] = [];
    const source = {
      collection(name: string) {
        requestedCollections.push(name);
        return {
          find() {
            return { async toArray() { return [{ _id: `${name}-1` }]; } };
          },
        };
      },
    };

    await expect(loadLegacySnapshot(source)).resolves.toEqual({
      users: [{ _id: 'users-1' }],
      trips: [{ _id: 'trips-1' }],
      members: [{ _id: 'members-1' }],
      expenses: [{ _id: 'expenses-1' }],
      messages: [{ _id: 'chatmessages-1' }],
    });
    expect(requestedCollections).toEqual(['users', 'trips', 'members', 'expenses', 'chatmessages']);
  });

  it('requires explicit migration-source and target configuration and parses dry-run', () => {
    expect(() => parseMigrationCliOptions([], {})).toThrow('MONGODB_URI is required');
    expect(() => parseMigrationCliOptions([], { MONGODB_URI: 'mongodb://source' }))
      .toThrow('DATABASE_URL is required');
    expect(parseMigrationCliOptions(['--dry-run'], {
      MONGODB_URI: 'mongodb://source',
      DATABASE_URL: 'postgres://target',
      MONGODB_DATABASE: 'legacy',
    })).toEqual({
      dryRun: true,
      mongodbUri: 'mongodb://source',
      mongodbDatabase: 'legacy',
    });
    expect(() => parseMigrationCliOptions(['--force'], {
      MONGODB_URI: 'mongodb://source', DATABASE_URL: 'postgres://target',
    })).toThrow('Unknown argument: --force');
  });
});
