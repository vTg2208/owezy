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
});
