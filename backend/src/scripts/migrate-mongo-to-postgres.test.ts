import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DisabledReceiptStorage, LocalReceiptStorage } from '../storage/receiptStorage';
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

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'owezy-migration-receipts-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

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

  it('rejects users whose normalized email duplicates another source user', () => {
    const snapshot = validSnapshot();
    snapshot.users.push({
      _id: 'firebase-u3', email: '  ONE@EXAMPLE.COM ', name: 'Three',
      created_at: '2026-08-07T00:00:00.000Z',
    });

    const plan = transformLegacySnapshot(snapshot);

    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_normalized_email', legacyId: 'firebase-u3' }),
    ]));
    expect(plan.users.some(({ legacyId }) => legacyId === 'firebase-u3')).toBe(false);
  });

  it('rejects trips whose normalized room code duplicates another source trip', () => {
    const snapshot = validSnapshot();
    snapshot.trips.push({
      _id: 'trip-2', name: 'Duplicate room', room_code: ' abc123 ', admin_id: 'member-3',
      created_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z',
    });
    snapshot.members.push({
      _id: 'member-3', trip_id: 'trip-2', name: 'Three', user_id: 'firebase-u2', is_admin: true,
      created_at: '2026-08-07T00:00:00.000Z',
    });

    const plan = transformLegacySnapshot(snapshot);

    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_room_code', legacyId: 'trip-2' }),
    ]));
    expect(plan.trips.some(({ id }) => id === 'trip-2')).toBe(false);
  });

  it('rejects a second active membership for the same trip and user', () => {
    const snapshot = validSnapshot();
    snapshot.members.push({
      _id: 'member-3', trip_id: 'trip-1', name: 'Second identity', user_id: 'firebase-u2',
      is_admin: false, created_at: '2026-08-07T00:00:00.000Z',
    });

    const plan = transformLegacySnapshot(snapshot);

    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_trip_user_membership', legacyId: 'member-3' }),
    ]));
    expect(plan.memberships.some(({ id }) => id === 'member-3')).toBe(false);
  });

  it('rejects active member display names that collide case-insensitively within a trip', () => {
    const snapshot = validSnapshot();
    snapshot.members.push({
      _id: 'member-3', trip_id: 'trip-1', name: ' tWo ', is_admin: false,
      created_at: '2026-08-07T00:00:00.000Z',
    });

    const plan = transformLegacySnapshot(snapshot);

    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_active_member_name', legacyId: 'member-3' }),
    ]));
    expect(plan.memberships.some(({ id }) => id === 'member-3')).toBe(false);
  });

  it('rejects a trip whose owner membership has no resolvable user identity', () => {
    const snapshot = validSnapshot();
    delete snapshot.members[0].user_id;

    const plan = transformLegacySnapshot(snapshot);

    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'orphan_trip_owner', legacyId: 'trip-1' }),
    ]));
    expect(plan.trips).toHaveLength(0);
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
      rejected: { users: 0, trips: 0, memberships: 0, expenses: 0, expenseSplits: 0, receipts: 0, messages: 0 },
    });
  });

  it('reports a source reconciliation mismatch when a transformed record is silently dropped', () => {
    const plan = transformLegacySnapshot(validSnapshot());
    plan.messages.pop();

    const verification = verifyMigration(plan);

    expect(verification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source_reconciliation_mismatch', legacyId: 'messages',
      }),
    ]));
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

  async write(
    bytes: Buffer,
    contentType: SupportedReceiptContentType,
    objectId: string,
  ) {
    this.writes += 1;
    const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1];
    const storageKey = `${objectId}.${extension}`;
    this.objects.set(storageKey, Buffer.from(bytes));
    return { storageKey };
  }

  async read(storageKey: string) {
    const bytes = this.objects.get(storageKey);
    if (!bytes) throw Object.assign(new Error('object missing'), { code: 'ENOENT' });
    return bytes;
  }

  async remove(storageKey: string) {
    this.objects.delete(storageKey);
  }
}

interface ReceiptRowFixture {
  id: string;
  expense_id: string;
  trip_id: string;
  uploaded_by_membership_id: string;
  storage_key: string;
  content_type: string;
  byte_size: number;
  checksum_sha256: string;
  status: string;
}

function returnedUser(values?: unknown[]) {
  return {
    id: values?.[0], firebase_uid: values?.[1], email: values?.[2], name: values?.[3],
    created_at: values?.[4],
  };
}

class ReceiptRestartDatabase {
  mapping: string | null = null;
  row: ReceiptRowFixture | null = null;
  failAfterReceipt = false;
  receiptInserts = 0;

  async query(text: string, values?: unknown[]) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('INSERT INTO users')) {
      return { rows: [returnedUser(values)], rowCount: 1 };
    }
    if (sql.startsWith('SELECT postgres_id FROM legacy_id_mappings')) {
      return this.mapping
        ? { rows: [{ postgres_id: this.mapping }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT id, expense_id') && sql.includes('FROM receipts')) {
      return this.row ? { rows: [this.row], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('INSERT INTO receipts')) {
      this.receiptInserts += 1;
      this.row = {
        id: String(values?.[0]),
        expense_id: String(values?.[1]),
        trip_id: String(values?.[2]),
        uploaded_by_membership_id: String(values?.[3]),
        storage_key: String(values?.[4]),
        content_type: String(values?.[5]),
        byte_size: Number(values?.[6]),
        checksum_sha256: String(values?.[7]),
        status: 'attached',
      };
    }
    if (sql.startsWith('INSERT INTO legacy_id_mappings') && values?.[0] === 'receipt') {
      this.mapping = String(values[2]);
    }
    if (this.failAfterReceipt && sql.startsWith('INSERT INTO chat_messages')) {
      throw new Error('transaction failed after receipt write');
    }
    return { rows: [], rowCount: 1 };
  }
}

function expectedReceiptRow(storageKey: string): ReceiptRowFixture {
  const receipt = transformLegacySnapshot(validSnapshot()).receipts[0];
  return {
    id: receipt.id,
    expense_id: receipt.expenseId,
    trip_id: receipt.tripId,
    uploaded_by_membership_id: receipt.uploadedByMembershipId,
    storage_key: storageKey,
    content_type: receipt.contentType,
    byte_size: receipt.byteSize,
    checksum_sha256: receipt.checksumSha256,
    status: 'attached',
  };
}

describe('PostgresMigrationTarget', () => {
  it('uses idempotent SQL and validates committed receipt objects without rewriting them', async () => {
    const statements: Array<{ sql: string; values?: unknown[]; inTransaction: boolean }> = [];
    let transactionOpen = false;
    let transactionCalls = 0;
    let receiptMapped = false;
    let receiptRow: ReceiptRowFixture | null = null;
    const database = {
      async query(text: string, values?: unknown[]) {
        const sql = text.replace(/\s+/g, ' ').trim();
        statements.push({ sql, values, inTransaction: transactionOpen });
        if (sql.startsWith('INSERT INTO users')) {
          return { rows: [returnedUser(values)], rowCount: 1 };
        }
        if (sql.startsWith('SELECT postgres_id FROM legacy_id_mappings')) {
          return receiptMapped
            ? { rows: [{ postgres_id: 'receipt-c950f3315cf046c6fe00c738' }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('SELECT id, expense_id') && sql.includes('FROM receipts')) {
          return receiptRow ? { rows: [receiptRow], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('INSERT INTO receipts')) {
          receiptRow = {
            id: String(values?.[0]), expense_id: String(values?.[1]), trip_id: String(values?.[2]),
            uploaded_by_membership_id: String(values?.[3]), storage_key: String(values?.[4]),
            content_type: String(values?.[5]), byte_size: Number(values?.[6]),
            checksum_sha256: String(values?.[7]), status: 'attached',
          };
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

  it('rejects a rerun whose existing non-receipt mapping points at another target', async () => {
    const plan = transformLegacySnapshot(validSnapshot());
    const database = {
      async query(text: string, values?: unknown[]) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('INSERT INTO users')) {
          return { rows: [returnedUser(values)], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO legacy_id_mappings') && values?.[0] === 'user') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('SELECT postgres_id FROM legacy_id_mappings')) {
          return { rows: [{ postgres_id: 'wrong-user-target' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await expect(target.apply(plan, new RecordingStorage()))
      .rejects.toThrow('user mapping identity mismatch');
  });

  it('rejects an existing Firebase user whose immutable creation identity conflicts', async () => {
    const original = transformLegacySnapshot(validSnapshot());
    const usersOnly = {
      ...original,
      trips: [], memberships: [], expenses: [], expenseSplits: [], receipts: [], messages: [],
    };
    const database = {
      async query(text: string, values?: unknown[]) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('INSERT INTO users')) {
          return {
            rows: [{ ...returnedUser(values), created_at: new Date('2020-01-01T00:00:00.000Z') }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await expect(target.apply(usersOnly, new RecordingStorage()))
      .rejects.toThrow('User target identity mismatch');
  });

  it('rejects a preexisting membership target ID linked to another trip', async () => {
    const plan = transformLegacySnapshot(validSnapshot());
    const database = {
      async query(text: string, values?: unknown[]) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('INSERT INTO users')) {
          return { rows: [returnedUser(values)], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO trip_memberships') && values?.[0] === 'member-1') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('SELECT id, trip_id, user_id') && sql.includes('FROM trip_memberships')) {
          return {
            rows: [{
              id: 'member-1', trip_id: 'another-trip', user_id: values?.[2], display_name: 'One',
              role: 'owner', status: 'active', created_at: new Date('2026-08-03T00:00:00.000Z'),
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await expect(target.apply(plan, new RecordingStorage()))
      .rejects.toThrow('Membership target identity mismatch for member-1');
  });

  it('reports a persisted row whose linked identity differs from the migration plan', async () => {
    const plan = transformLegacySnapshot(validSnapshot());
    const receipt = plan.receipts[0];
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
        if (sql.startsWith('WITH expected_users AS')) {
          return {
            rows: [{
              entity: 'message', legacy_id: 'message-1',
              reason: 'membership reference differs from transformed source',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM legacy_id_mappings m') && sql.includes('LEFT JOIN receipts r')) {
          return {
            rows: [{ postgres_id: receipt.id, ...expectedReceiptRow(`${receipt.id}.png`) }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('WITH expected_users AS')) return { rows: [], rowCount: 0 };
        if (sql.includes('AS orphan_count')) return { rows: [{ orphan_count: '0' }], rowCount: 1 };
        if (sql.includes('HAVING sum(s.amount_minor)')) return { rows: [], rowCount: 0 };
        if (sql.includes('HAVING sum(delta)')) return { rows: [], rowCount: 0 };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const storage = new RecordingStorage();
    await storage.write(receipt.bytes, receipt.contentType, receipt.id);

    await expect(new PostgresMigrationTarget(database, async (work) => work(database)).verify(plan, storage))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'database_row_identity_mismatch', entity: 'message', legacyId: 'message-1',
        }),
      ]));
  });

  it('repairs a missing receipt mapping only after validating the row and real stored bytes', async () => {
    const root = await temporaryDirectory();
    const storage = new LocalReceiptStorage(root);
    const plan = transformLegacySnapshot(validSnapshot());
    const receipt = plan.receipts[0];
    await storage.write(receipt.bytes, receipt.contentType, receipt.id);
    const database = new ReceiptRestartDatabase();
    database.row = expectedReceiptRow(`${receipt.id}.png`);
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await target.apply(plan, storage);

    expect(database.mapping).toBe(receipt.id);
    expect(database.receiptInserts).toBe(0);
  });

  it('rejects a receipt mapping directed at a different target identity', async () => {
    const plan = transformLegacySnapshot(validSnapshot());
    const database = new ReceiptRestartDatabase();
    database.mapping = 'receipt-wrong-target';
    const storage = new RecordingStorage();
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await expect(target.apply(plan, storage)).rejects.toThrow('Receipt mapping identity mismatch');
    expect(storage.writes).toBe(0);
  });

  it('rejects mapped receipt metadata that belongs to a different expense', async () => {
    const plan = transformLegacySnapshot(validSnapshot());
    const receipt = plan.receipts[0];
    const database = new ReceiptRestartDatabase();
    database.mapping = receipt.id;
    database.row = { ...expectedReceiptRow(`${receipt.id}.png`), expense_id: 'expense-wrong' };
    const storage = new RecordingStorage();
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await expect(target.apply(plan, storage)).rejects.toThrow('Receipt target metadata mismatch');
    expect(storage.writes).toBe(0);
  });

  it('repairs a missing receipt row even when its mapping already exists', async () => {
    const root = await temporaryDirectory();
    const storage = new LocalReceiptStorage(root);
    const plan = transformLegacySnapshot(validSnapshot());
    const receipt = plan.receipts[0];
    const database = new ReceiptRestartDatabase();
    database.mapping = receipt.id;
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await target.apply(plan, storage);

    expect(database.row).toEqual(expectedReceiptRow(`${receipt.id}.png`));
    await expect(readFile(join(root, `${receipt.id}.png`))).resolves.toEqual(receipt.bytes);
  });

  it('repairs a missing receipt object referenced by otherwise valid metadata', async () => {
    const root = await temporaryDirectory();
    const storage = new LocalReceiptStorage(root);
    const plan = transformLegacySnapshot(validSnapshot());
    const receipt = plan.receipts[0];
    const database = new ReceiptRestartDatabase();
    database.mapping = receipt.id;
    database.row = expectedReceiptRow(`${receipt.id}.png`);
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await target.apply(plan, storage);

    await expect(readFile(join(root, `${receipt.id}.png`))).resolves.toEqual(receipt.bytes);
  });

  it('replaces corrupt receipt bytes instead of trusting valid-looking mapping metadata', async () => {
    const root = await temporaryDirectory();
    const storage = new LocalReceiptStorage(root);
    const plan = transformLegacySnapshot(validSnapshot());
    const receipt = plan.receipts[0];
    await writeFile(join(root, `${receipt.id}.png`), 'corrupt');
    const database = new ReceiptRestartDatabase();
    database.mapping = receipt.id;
    database.row = expectedReceiptRow(`${receipt.id}.png`);
    const target = new PostgresMigrationTarget(database, async (work) => work(database));

    await target.apply(plan, storage);

    await expect(readFile(join(root, `${receipt.id}.png`))).resolves.toEqual(receipt.bytes);
  });

  it('surfaces cleanup failure and reruns from a deterministic real-storage orphan', async () => {
    const root = await temporaryDirectory();
    const localStorage = new LocalReceiptStorage(root);
    const failingStorage: ReceiptStorage = {
      write: (bytes, contentType, objectId) => localStorage.write(bytes, contentType, objectId),
      read: (storageKey) => localStorage.read(storageKey),
      async remove() { throw new Error('cleanup unavailable'); },
    };
    const plan = transformLegacySnapshot(validSnapshot());
    const receipt = plan.receipts[0];
    const failedDatabase = new ReceiptRestartDatabase();
    failedDatabase.failAfterReceipt = true;
    const failedTarget = new PostgresMigrationTarget(
      failedDatabase,
      async (work) => work(failedDatabase),
    );

    await expect(failedTarget.apply(plan, failingStorage)).rejects.toThrow(
      'Migration transaction failed and receipt storage cleanup also failed',
    );
    await expect(readFile(join(root, `${receipt.id}.png`))).resolves.toEqual(receipt.bytes);

    const restartedDatabase = new ReceiptRestartDatabase();
    const restartedTarget = new PostgresMigrationTarget(
      restartedDatabase,
      async (work) => work(restartedDatabase),
    );
    await restartedTarget.apply(plan, localStorage);

    expect(restartedDatabase.mapping).toBe(receipt.id);
    expect(restartedDatabase.row).toEqual(expectedReceiptRow(`${receipt.id}.png`));
  });

  it('verifies database counts, references, split totals, and zero-sum balances', async () => {
    const plan = transformLegacySnapshot(validSnapshot());
    const receipt = plan.receipts[0];
    let countsSql = '';
    let identitySql = '';
    const database = {
      async query(text: string) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.includes('AS expense_splits') && sql.includes('AS users')) {
          countsSql = sql;
          return {
            rows: [{
              users: '2', trips: '1', memberships: '2', expenses: '1',
              expense_splits: '2', receipts: '1', messages: '1',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM legacy_id_mappings m') && sql.includes('LEFT JOIN receipts r')) {
          return {
            rows: [{ postgres_id: receipt.id, ...expectedReceiptRow(`${receipt.id}.png`) }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('WITH expected_users AS')) {
          identitySql = sql;
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('AS orphan_count')) return { rows: [{ orphan_count: '0' }], rowCount: 1 };
        if (sql.includes('HAVING sum(s.amount_minor)')) return { rows: [], rowCount: 0 };
        if (sql.includes('HAVING sum(delta)')) return { rows: [], rowCount: 0 };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const target = new PostgresMigrationTarget(database, async (work) => work(database));
    const storage = new RecordingStorage();
    await storage.write(receipt.bytes, receipt.contentType, receipt.id);

    await expect(target.verify(plan, storage)).resolves.toEqual([]);
    expect(countsSql).toContain("JOIN receipts receipt_target ON receipt_target.id::text = receipt_map.postgres_id");
    expect(identitySql).toContain("target.currency IS DISTINCT FROM e.currency");
    expect(identitySql).toContain("target.updated_at IS DISTINCT FROM e.updated_at");
  });

  it('reports a mismatched migrated database count', async () => {
    const plan = transformLegacySnapshot(validSnapshot());
    const receipt = plan.receipts[0];
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
        if (sql.includes('FROM legacy_id_mappings m') && sql.includes('LEFT JOIN receipts r')) {
          return {
            rows: [{ postgres_id: receipt.id, ...expectedReceiptRow(`${receipt.id}.png`) }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('WITH expected_users AS')) return { rows: [], rowCount: 0 };
        if (sql.includes('AS orphan_count')) return { rows: [{ orphan_count: '0' }], rowCount: 1 };
        if (sql.includes('HAVING sum(s.amount_minor)')) return { rows: [], rowCount: 0 };
        if (sql.includes('HAVING sum(delta)')) return { rows: [], rowCount: 0 };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const target = new PostgresMigrationTarget(database, async (work) => work(database));
    const storage = new RecordingStorage();
    await storage.write(receipt.bytes, receipt.contentType, receipt.id);

    await expect(target.verify(plan, storage)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'database_count_mismatch', legacyId: 'expenses' }),
    ]));
  });

  it('reports corrupt persisted receipt bytes during post-write verification', async () => {
    const plan = transformLegacySnapshot(validSnapshot());
    const receipt = plan.receipts[0];
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
        if (sql.includes('FROM legacy_id_mappings m') && sql.includes('LEFT JOIN receipts r')) {
          return {
            rows: [{ postgres_id: receipt.id, ...expectedReceiptRow(`${receipt.id}.png`) }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('WITH expected_users AS')) return { rows: [], rowCount: 0 };
        if (sql.includes('AS orphan_count')) return { rows: [{ orphan_count: '0' }], rowCount: 1 };
        if (sql.includes('HAVING sum(s.amount_minor)')) return { rows: [], rowCount: 0 };
        if (sql.includes('HAVING sum(delta)')) return { rows: [], rowCount: 0 };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const target = new PostgresMigrationTarget(database, async (work) => work(database));
    const storage = new RecordingStorage();
    storage.objects.set(`${receipt.id}.png`, Buffer.from('corrupt'));

    await expect(target.verify(plan, storage)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'database_receipt_object_invalid', legacyId: receipt.legacyId,
      }),
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
