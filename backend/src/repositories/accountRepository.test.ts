import { describe, expect, it } from 'vitest';
import { AccountService } from '../services/accountService';
import { PostgresAccountRepository } from './accountRepository';

interface Result {
  rows: Record<string, unknown>[];
  rowCount: number;
}

class AccountQueryBoundary {
  readonly statements: string[] = [];
  readonly trip = { id: 'trip-1', ownerMembershipId: 'owner-1' };
  readonly membership = {
    id: 'owner-1',
    userId: '11111111-1111-4111-8111-111111111111' as string | null,
    displayName: 'Alice',
    role: 'owner',
    status: 'active',
    leftAt: new Date('2026-08-30T00:00:00.000Z') as Date | null,
    anonymizedAt: null as Date | null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  };
  readonly successors = [
    {
      id: 'member-earlier-z', userId: '55555555-5555-4555-8555-555555555555' as string | null,
      displayName: 'Early Z', role: 'member', status: 'active', leftAt: null as Date | null,
      anonymizedAt: null as Date | null, createdAt: new Date('2026-08-01T12:00:00.000Z'),
    },
    {
      id: 'member-b', userId: '22222222-2222-4222-8222-222222222222' as string | null,
      displayName: 'Bob', role: 'member', status: 'active', leftAt: null as Date | null,
      anonymizedAt: null as Date | null, createdAt: new Date('2026-08-02T00:00:00.000Z'),
    },
    {
      id: 'member-a', userId: '33333333-3333-4333-8333-333333333333' as string | null,
      displayName: 'Amy', role: 'member', status: 'active', leftAt: null as Date | null,
      anonymizedAt: null as Date | null, createdAt: new Date('2026-08-02T00:00:00.000Z'),
    },
    {
      id: 'member-earlier', userId: '44444444-4444-4444-8444-444444444444' as string | null,
      displayName: 'Early', role: 'member', status: 'active', leftAt: null as Date | null,
      anonymizedAt: null as Date | null, createdAt: new Date('2026-08-01T12:00:00.000Z'),
    },
  ];
  transactionOpen = false;
  deletionUpdatedInsideTransaction = false;
  ownershipUpdatedInsideTransaction = false;

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

    if (normalized.startsWith('SELECT owner.id AS owner_membership_id')) {
      if (!normalized.includes("candidate.status = 'active'")) throw new Error('inactive successor could be selected');
      if (!normalized.includes('ORDER BY candidate.created_at, candidate.id')) {
        throw new Error('successor choice is not deterministic');
      }
      if (!normalized.includes('FOR UPDATE OF owner, trip')) throw new Error('owned trip was not locked');
      const successor = this.successors
        .filter((candidate) => candidate.status === 'active')
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()
          || left.id.localeCompare(right.id))[0];
      return {
        rows: [{
          owner_membership_id: this.membership.id,
          trip_id: this.trip.id,
          successor_membership_id: successor?.id ?? null,
        }],
        rowCount: 1,
      };
    }

    if (normalized.startsWith('UPDATE trip_memberships') && normalized.includes("SET role = 'member'")) {
      this.ownershipUpdatedInsideTransaction = this.transactionOpen;
      if (values?.[0] === this.membership.id) this.membership.role = 'member';
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('UPDATE trip_memberships') && normalized.includes("SET role = 'owner'")) {
      this.ownershipUpdatedInsideTransaction = this.transactionOpen;
      if (this.membership.role === 'owner') throw new Error('unique owner constraint would fail');
      if (!normalized.includes("status = 'active'")) throw new Error('inactive successor could be promoted');
      const successor = this.successors.find((candidate) => candidate.id === values?.[0]);
      if (successor?.status === 'active') successor.role = 'owner';
      return { rows: [], rowCount: successor?.status === 'active' ? 1 : 0 };
    }

    if (normalized.startsWith('UPDATE trips')) {
      this.ownershipUpdatedInsideTransaction = this.transactionOpen;
      if (!normalized.includes('owner_membership_id = $2')
        || !normalized.includes('owner_membership_id = $3')) {
        throw new Error('trip owner pointer was not safely relinked');
      }
      const successor = this.successors.find((candidate) => candidate.id === values?.[1]);
      if (successor?.role !== 'owner') throw new Error('trip linked before successor promotion');
      this.trip.ownerMembershipId = String(values?.[1]);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('UPDATE trip_memberships')) {
      this.deletionUpdatedInsideTransaction = this.transactionOpen;
      if (normalized.includes('user_id = NULL')) this.membership.userId = null;
      if (normalized.includes("status = 'anonymized'")) this.membership.status = 'anonymized';
      if (normalized.includes("display_name = 'Former member ' || id")) {
        this.membership.displayName = `Former member ${this.membership.id}`;
      }
      if (normalized.includes('left_at = NULL')) this.membership.leftAt = null;
      if (normalized.includes('anonymized_at = COALESCE(anonymized_at, now())')) {
        this.membership.anonymizedAt = new Date('2026-08-31T00:00:00.000Z');
      }
      return { rows: [], rowCount: 2 };
    }

    if (normalized.startsWith('UPDATE users')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${normalized}`);
  }
}

class ConcurrentDeletionBoundary extends AccountQueryBoundary {
  private firstOwnershipQuery = true;

  constructor(
    private readonly deadlockVictim: boolean,
    private readonly meetConcurrentDeletion: () => Promise<void>,
  ) {
    super();
  }

  override async query(text: string, values?: unknown[]): Promise<Result> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (this.firstOwnershipQuery
      && normalized.startsWith('SELECT owner.id AS owner_membership_id')) {
      this.firstOwnershipQuery = false;
      await this.meetConcurrentDeletion();
      if (this.deadlockVictim) {
        throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
      }
    }
    return super.query(text, values);
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
    expect(database.ownershipUpdatedInsideTransaction).toBe(true);
    expect(database.membership).toEqual({
      id: 'owner-1',
      userId: null,
      displayName: 'Former member owner-1',
      role: 'member',
      status: 'anonymized',
      leftAt: null,
      anonymizedAt: new Date('2026-08-31T00:00:00.000Z'),
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(database.trip.ownerMembershipId).toBe('member-earlier');
    expect(database.successors.find(({ id }) => id === 'member-earlier')).toMatchObject({
      role: 'owner', status: 'active', displayName: 'Early',
    });
    expect(database.successors.filter(({ role }) => role === 'owner')).toHaveLength(1);
  });

  it('keeps an anonymized historical owner when the trip has no active successor', async () => {
    const database = new AccountQueryBoundary();
    for (const successor of database.successors) successor.status = 'left';
    const repository = new PostgresAccountRepository(database, async (work) => work(database));

    await repository.beginAccountDeletion('firebase-1');

    expect(database.membership).toMatchObject({
      userId: null,
      displayName: 'Former member owner-1',
      role: 'owner',
      status: 'anonymized',
    });
    expect(database.trip.ownerMembershipId).toBe('owner-1');
  });

  it('retries the database phase when concurrent account deletions deadlock', async () => {
    let arrivals = 0;
    let releaseConcurrentQueries!: () => void;
    const concurrentQueries = new Promise<void>((resolve) => {
      releaseConcurrentQueries = resolve;
    });
    const meetConcurrentDeletion = async () => {
      arrivals += 1;
      if (arrivals === 2) releaseConcurrentQueries();
      await concurrentQueries;
    };
    const first = new ConcurrentDeletionBoundary(true, meetConcurrentDeletion);
    const second = new ConcurrentDeletionBoundary(false, meetConcurrentDeletion);
    let firstTransactionAttempts = 0;
    let secondTransactionAttempts = 0;
    const firstRepository = new PostgresAccountRepository(first, async (work) => {
      firstTransactionAttempts += 1;
      return work(first);
    });
    const secondRepository = new PostgresAccountRepository(second, async (work) => {
      secondTransactionAttempts += 1;
      return work(second);
    });
    let firstFirebaseDeletions = 0;
    let secondFirebaseDeletions = 0;
    const firstService = new AccountService(firstRepository, {
      async deleteUser() {
        firstFirebaseDeletions += 1;
      },
    });
    const secondService = new AccountService(secondRepository, {
      async deleteUser() {
        secondFirebaseDeletions += 1;
      },
    });

    await expect(Promise.all([
      firstService.deleteAccount('firebase-1'),
      secondService.deleteAccount('firebase-2'),
    ])).resolves.toEqual([
      { success: true },
      { success: true },
    ]);

    expect(firstTransactionAttempts).toBe(2);
    expect(secondTransactionAttempts).toBe(1);
    expect(firstFirebaseDeletions).toBe(1);
    expect(secondFirebaseDeletions).toBe(1);
    expect(first.membership.status).toBe('anonymized');
    expect(second.membership.status).toBe('anonymized');
  });

  it('stops after three database deadlocks', async () => {
    const database = new AccountQueryBoundary();
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    let transactionAttempts = 0;
    const repository = new PostgresAccountRepository(database, async () => {
      transactionAttempts += 1;
      throw deadlock;
    });

    await expect(repository.beginAccountDeletion('firebase-1')).rejects.toBe(deadlock);
    expect(transactionAttempts).toBe(3);
  });

  it('does not retry a non-deadlock database failure', async () => {
    const database = new AccountQueryBoundary();
    const constraintFailure = Object.assign(new Error('constraint failure'), { code: '23514' });
    let transactionAttempts = 0;
    const repository = new PostgresAccountRepository(database, async () => {
      transactionAttempts += 1;
      throw constraintFailure;
    });

    await expect(repository.beginAccountDeletion('firebase-1')).rejects.toBe(constraintFailure);
    expect(transactionAttempts).toBe(1);
  });
});
