import { describe, expect, it } from 'vitest';
import { PostgresTripRepository } from './tripRepository';
import { Membership, TripRecord } from '../services/tripService';

class TripQueryBoundary {
  readonly statements: string[] = [];
  transactionOpen = false;
  tripInsertedInTransaction = false;
  ownerInsertedInTransaction = false;

  async query(text: string, values?: unknown[]) {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push(sql);
    if (sql.startsWith('SELECT id FROM users')) {
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO trips')) {
      this.tripInsertedInTransaction = this.transactionOpen;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO trip_memberships')) {
      this.ownerInsertedInTransaction = this.transactionOpen;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM trips t') && sql.includes('FOR UPDATE OF t')) {
      if (!sql.includes("m.status = 'active'")) throw new Error('name conflict was not limited to active memberships');
      if (!sql.includes('t.archived_at IS NULL')) throw new Error('archived trip remained joinable');
      return {
        rows: [{
          trip_id: 'trip-1', trip_name: 'Goa', room_code: values?.[0], owner_membership_id: 'owner-1',
          is_locked: false, trip_created_at: new Date('2026-08-31T00:00:00.000Z'),
          user_id: '11111111-1111-4111-8111-111111111111', existing_id: null,
          existing_name: null, existing_role: null, existing_status: null, existing_created_at: null,
          name_conflict: true,
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

const trip: TripRecord = {
  id: 'trip-1', name: 'Goa', roomCode: 'ABC123', ownerMembershipId: 'owner-1', isLocked: false,
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
};
const owner: Membership = {
  id: 'owner-1', tripId: 'trip-1', firebaseUid: 'firebase-1', name: 'Owner', role: 'owner', status: 'active',
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
};

describe('PostgresTripRepository', () => {
  it('inserts the trip and owner membership in the same transaction', async () => {
    const database = new TripQueryBoundary();
    const repository = new PostgresTripRepository(database, async (work) => {
      database.transactionOpen = true;
      try {
        return await work(database);
      } finally {
        database.transactionOpen = false;
      }
    });

    const created = await repository.createTripForUser('firebase-1', trip, owner);

    expect(created).toEqual({ trip, owner });
    expect(database.tripInsertedInTransaction).toBe(true);
    expect(database.ownerInsertedInTransaction).toBe(true);
  });

  it('reports a conflict only for an active case-insensitive trip name', async () => {
    const database = new TripQueryBoundary();
    const repository = new PostgresTripRepository(database, async (work) => work(database));

    await expect(repository.joinTripForUser('firebase-2', 'ABC123', 'owner', 'member-new'))
      .resolves.toEqual({ kind: 'name-conflict' });
  });

  it('returns an authenticated application receipt URL instead of a storage key', async () => {
    let receiptMetadataQueried = false;
    let activeExpensesOnly = false;
    const database = {
      async query(text: string) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql.includes('JOIN trip_memberships m ON m.trip_id = t.id')) {
          return { rows: [{
            id: 'trip-1', name: 'Goa', room_code: 'ABC123', owner_membership_id: 'owner-1',
            is_locked: false, created_at: new Date('2026-08-31T00:00:00.000Z'),
          }], rowCount: 1 };
        }
        if (sql.includes('FROM trip_memberships m')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM expenses e')) {
          receiptMetadataQueried = sql.includes('LEFT JOIN receipts');
          activeExpensesOnly = sql.includes("e.status = 'active'");
          return { rows: [{
            id: 'expense-1', trip_id: 'trip-1', paid_by_membership_id: 'owner-1',
            paid_by_name: 'Owner', description: 'Meal', total_minor: '1000', split_type: 'equal',
            receipt_id: 'receipt-1', created_at: new Date('2026-08-31T00:10:00.000Z'),
          }], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const repository = new PostgresTripRepository(database, async (work) => work(database));

    const details = await repository.getTripDetailsForMember('firebase-1', 'trip-1');

    expect(details?.expenses[0].receiptUrl).toBe('/api/trips/trip-1/receipts/receipt-1');
    expect(receiptMetadataQueried).toBe(true);
    expect(activeExpensesOnly).toBe(true);
  });

  it('locks a trip only when the Firebase user is still its active owner', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const database = {
      async query(text: string, values?: unknown[]) {
        const sql = text.replace(/\s+/g, ' ').trim();
        queries.push({ text: sql, values });
        if (sql.startsWith('UPDATE trips t')) return { rows: [{ id: 'trip-1' }], rowCount: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const repository = new PostgresTripRepository(database, async (work) => work(database));

    await expect(repository.setTripLockedForOwner('firebase-owner', 'trip-1', true))
      .resolves.toBe('updated');

    expect(queries[0].text).toContain("actor.status = 'active'");
    expect(queries[0].text).toContain("actor.role = 'owner'");
    expect(queries[0].text).toContain('u.firebase_uid = $1');
    expect(queries[0].text).toContain('t.owner_membership_id = actor.id');
    expect(queries[0].values).toEqual(['firebase-owner', 'trip-1', true]);
  });

  it('distinguishes a missing trip from a user who lost owner authorization before lock mutation', async () => {
    for (const tripExists of [true, false]) {
      const database = {
        async query(text: string) {
          const sql = text.replace(/\s+/g, ' ').trim();
          if (sql.startsWith('UPDATE trips t')) return { rows: [], rowCount: 0 };
          if (sql.startsWith('SELECT EXISTS')) {
            return { rows: [{ trip_exists: tripExists }], rowCount: 1 };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
      const repository = new PostgresTripRepository(database, async (work) => work(database));
      await expect(repository.setTripLockedForOwner('firebase-owner', 'trip-1', true))
        .resolves.toBe(tripExists ? 'forbidden' : 'not-found');
    }
  });

  it('authorizes and removes a member while the trip, actor, and target rows stay locked', async () => {
    const queries: string[] = [];
    let transactionOpen = false;
    const database = {
      async query(text: string) {
        const sql = text.replace(/\s+/g, ' ').trim();
        queries.push(sql);
        if (!transactionOpen) throw new Error('removal escaped its transaction');
        if (sql.startsWith('SELECT id FROM trips')) return { rows: [{ id: 'trip-1' }], rowCount: 1 };
        if (sql.includes('AS actor_id')) {
          return { rows: [{ actor_id: 'owner-1', actor_role: 'owner' }], rowCount: 1 };
        }
        if (sql.startsWith('SELECT id, role, status FROM trip_memberships')) {
          return { rows: [{ id: 'member-1', role: 'member', status: 'active' }], rowCount: 1 };
        }
        if (sql.startsWith('SELECT leave_trip_membership')) {
          return { rows: [{ outcome: 'left' }], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const repository = new PostgresTripRepository(database, async (work) => {
      transactionOpen = true;
      try { return await work(database); } finally { transactionOpen = false; }
    });

    await expect(repository.removeMemberForActor('firebase-owner', 'trip-1', 'member-1'))
      .resolves.toBe('removed');

    expect(queries[0]).toContain('FOR UPDATE');
    expect(queries[1]).toContain("actor.status = 'active'");
    expect(queries[1]).toContain('FOR UPDATE OF actor');
    expect(queries[2]).toContain('FOR UPDATE');
  });
});
