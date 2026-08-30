import { describe, expect, it } from 'vitest';
import { PostgresAccountRepository } from './accountRepository';

interface Result {
  rows: Record<string, unknown>[];
  rowCount: number;
}

class AccountQueryBoundary {
  readonly statements: string[] = [];
  transactionOpen = false;
  deletionUpdatedInsideTransaction = false;

  async query(text: string, values?: unknown[]): Promise<Result> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    this.statements.push(normalized);

    if (normalized.includes('INSERT INTO users')) {
      if (!normalized.includes('ON CONFLICT (firebase_uid)')) throw new Error('wrong upsert key');
      if (!normalized.includes("WHERE users.account_status = 'active'")) {
        throw new Error('deleting account could be repopulated');
      }
      return {
        rows: [{
          id: values?.[0],
          firebase_uid: values?.[1],
          email: values?.[2],
          name: values?.[3],
          created_at: new Date('2026-08-31T00:00:00.000Z'),
        }],
        rowCount: 1,
      };
    }

    if (normalized.startsWith('SELECT id, account_status')) {
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111', account_status: 'active' }], rowCount: 1 };
    }

    if (normalized.startsWith('UPDATE trip_memberships')) {
      this.deletionUpdatedInsideTransaction = this.transactionOpen;
      return { rows: [], rowCount: 2 };
    }

    if (normalized.startsWith('UPDATE users')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${normalized}`);
  }
}

describe('PostgresAccountRepository', () => {
  it('upserts by Firebase UID and maps the internal UUID separately', async () => {
    const database = new AccountQueryBoundary();
    const repository = new PostgresAccountRepository(database, async (work) => work(database));

    const user = await repository.upsertUser(
      'firebase-1',
      'person@example.com',
      'Person',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(user).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      firebaseUid: 'firebase-1',
      email: 'person@example.com',
      name: 'Person',
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
    });
  });

  it('anonymizes memberships and the user in one transaction', async () => {
    const database = new AccountQueryBoundary();
    const repository = new PostgresAccountRepository(database, async (work) => {
      database.transactionOpen = true;
      try {
        return await work(database);
      } finally {
        database.transactionOpen = false;
      }
    });

    const state = await repository.beginAccountDeletion('firebase-1');

    expect(state).toEqual({ userExists: true, firebaseDeleted: false });
    expect(database.deletionUpdatedInsideTransaction).toBe(true);
  });
});
