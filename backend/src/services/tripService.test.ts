import { describe, expect, it } from 'vitest';
import {
  JoinResult,
  Membership,
  TripDetails,
  TripRecord,
  TripRepository,
  TripService,
} from './tripService';

class MemoryTripRepository implements TripRepository {
  readonly trips = new Map<string, TripRecord>();
  readonly memberships = new Map<string, Membership>();

  async createTripForUser(
    firebaseUid: string,
    trip: TripRecord,
    owner: Membership,
  ): Promise<{ trip: TripRecord; owner: Membership }> {
    if (!firebaseUid) throw new Error('user missing');
    this.trips.set(trip.id, trip);
    this.memberships.set(owner.id, owner);
    return { trip, owner };
  }

  async joinTripForUser(
    firebaseUid: string,
    roomCode: string,
    displayName: string,
    membershipId: string,
  ): Promise<JoinResult> {
    const trip = [...this.trips.values()].find((candidate) => candidate.roomCode === roomCode);
    if (!trip) return { kind: 'not-found' };
    if (trip.isLocked) return { kind: 'locked' };
    const existing = [...this.memberships.values()].find(
      (membership) => membership.tripId === trip.id
        && membership.firebaseUid === firebaseUid
        && membership.status === 'active',
    );
    if (existing) return { kind: 'existing', trip, membership: existing };
    const duplicateName = [...this.memberships.values()].some(
      (membership) => membership.tripId === trip.id
        && membership.status === 'active'
        && membership.name.toLowerCase() === displayName.toLowerCase(),
    );
    if (duplicateName) return { kind: 'name-conflict' };
    const membership: Membership = {
      id: membershipId,
      tripId: trip.id,
      firebaseUid,
      name: displayName,
      role: 'member',
      status: 'active',
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
    };
    this.memberships.set(membership.id, membership);
    return { kind: 'joined', trip, membership };
  }

  async findActiveMembership(firebaseUid: string, tripId: string): Promise<Membership | null> {
    return [...this.memberships.values()].find(
      (membership) => membership.firebaseUid === firebaseUid
        && membership.tripId === tripId
        && membership.status === 'active',
    ) ?? null;
  }

  async getTripDetailsForMember(firebaseUid: string, tripId: string): Promise<TripDetails | null> {
    const membership = await this.findActiveMembership(firebaseUid, tripId);
    const trip = this.trips.get(tripId);
    if (!membership || !trip) return null;
    return {
      trip,
      participants: [...this.memberships.values()].filter(
        (candidate) => candidate.tripId === tripId && candidate.status === 'active',
      ),
      expenses: [],
    };
  }

  async getExpensePageForMember() {
    return { expenses: [] };
  }

  async setTripLockedForOwner(
    firebaseUid: string,
    tripId: string,
    locked: boolean,
  ): Promise<'updated' | 'forbidden' | 'not-found'> {
    const trip = this.trips.get(tripId);
    if (!trip) return 'not-found';
    const actor = await this.findActiveMembership(firebaseUid, tripId);
    if (!actor || actor.role !== 'owner' || trip.ownerMembershipId !== actor.id) return 'forbidden';
    trip.isLocked = locked;
    return 'updated';
  }

  async removeMemberForActor(
    firebaseUid: string,
    tripId: string,
    membershipId: string,
  ): Promise<'removed' | 'forbidden' | 'not-found' | 'owner-required'> {
    const trip = this.trips.get(tripId);
    if (!trip) return 'not-found';
    const actor = await this.findActiveMembership(firebaseUid, tripId);
    if (!actor) return 'forbidden';
    const target = this.memberships.get(membershipId);
    if (!target || target.tripId !== tripId || target.status !== 'active') return 'not-found';
    if (actor.id !== target.id && actor.role !== 'owner') return 'forbidden';
    if (target.role === 'owner') {
      const successor = [...this.memberships.values()]
        .filter((candidate) => candidate.tripId === tripId
          && candidate.id !== target.id
          && candidate.firebaseUid !== null
          && candidate.status === 'active')
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()
          || left.id.localeCompare(right.id))[0];
      if (!successor) return 'owner-required';
      target.role = 'member';
      successor.role = 'owner';
      trip.ownerMembershipId = successor.id;
    }
    target.status = 'left';
    return 'removed';
  }
}

function seedRepository(): MemoryTripRepository {
  const repository = new MemoryTripRepository();
  repository.trips.set('trip-1', {
    id: 'trip-1',
    name: 'Goa',
    roomCode: 'ABC123',
    ownerMembershipId: 'owner-1',
    isLocked: false,
    createdAt: new Date('2026-08-31T00:00:00.000Z'),
  });
  repository.memberships.set('owner-1', {
    id: 'owner-1', tripId: 'trip-1', firebaseUid: 'owner-user', name: 'Owner', role: 'owner', status: 'active', createdAt: new Date(),
  });
  repository.memberships.set('member-1', {
    id: 'member-1', tripId: 'trip-1', firebaseUid: 'member-user', name: 'Member', role: 'member', status: 'active', createdAt: new Date(),
  });
  return repository;
}

function sequenceIds(...ids: string[]): () => string {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error('No test ID left');
    return id;
  };
}

describe('TripService', () => {
  it('creates a trip and its owner membership as one repository operation', async () => {
    const repository = new MemoryTripRepository();
    const service = new TripService(repository, sequenceIds('trip-new', 'owner-new'), () => 'ROOM42');

    const result = await service.createTrip('firebase-1', ' Kerala ', ' Alice ');

    expect(result).toEqual({
      tripId: 'trip-new',
      roomCode: 'ROOM42',
      member: { id: 'owner-new', name: 'Alice', isAdmin: true },
    });
    expect(repository.trips.get('trip-new')?.ownerMembershipId).toBe('owner-new');
    expect(repository.memberships.get('owner-new')).toMatchObject({ role: 'owner', status: 'active' });
  });

  it('returns the existing active membership when join is retried', async () => {
    const repository = seedRepository();
    const service = new TripService(repository, sequenceIds('unused'), () => 'unused');

    const result = await service.joinTrip('member-user', 'abc123', 'Different ignored name');

    expect(result).toEqual({
      tripId: 'trip-1',
      tripName: 'Goa',
      member: { id: 'member-1', name: 'Member', isAdmin: false },
      created: false,
    });
  });

  it('rejects joins to locked trips and case-insensitive duplicate active names', async () => {
    const lockedRepository = seedRepository();
    lockedRepository.trips.get('trip-1')!.isLocked = true;
    const lockedService = new TripService(lockedRepository, sequenceIds('new-1'), () => 'unused');
    await expect(lockedService.joinTrip('new-user', 'ABC123', 'New')).rejects.toMatchObject({ status: 403 });

    const duplicateRepository = seedRepository();
    const duplicateService = new TripService(duplicateRepository, sequenceIds('new-2'), () => 'unused');
    await expect(duplicateService.joinTrip('new-user', 'ABC123', 'member')).rejects.toMatchObject({ status: 400 });
  });

  it('requires an active membership for trip reads', async () => {
    const service = new TripService(seedRepository(), sequenceIds('unused'), () => 'unused');

    await expect(service.getTrip('outsider', 'trip-1')).rejects.toMatchObject({ status: 403 });
  });

  it('allows only the owner to lock or unlock a trip', async () => {
    const repository = seedRepository();
    const service = new TripService(repository, sequenceIds('unused'), () => 'unused');

    await expect(service.setLocked('member-user', 'trip-1', true)).rejects.toMatchObject({ status: 403 });
    await service.setLocked('owner-user', 'trip-1', true);
    expect(repository.trips.get('trip-1')?.isLocked).toBe(true);
  });

  it('returns not found for locking a missing trip and forbidden for a stale owner', async () => {
    const repository = seedRepository();
    const service = new TripService(repository, sequenceIds('unused'), () => 'unused');

    await expect(service.setLocked('owner-user', 'missing', true)).rejects.toMatchObject({ status: 404 });
    repository.memberships.get('owner-1')!.status = 'left';
    await expect(service.setLocked('owner-user', 'trip-1', true)).rejects.toMatchObject({ status: 403 });
  });

  it('lets a member leave and lets only the owner remove someone else without deleting history', async () => {
    const selfRepository = seedRepository();
    const selfService = new TripService(selfRepository, sequenceIds('unused'), () => 'unused');
    await selfService.removeMember('member-user', 'trip-1', 'member-1');
    expect(selfRepository.memberships.get('member-1')?.status).toBe('left');

    const forbiddenRepository = seedRepository();
    const forbiddenService = new TripService(forbiddenRepository, sequenceIds('unused'), () => 'unused');
    await expect(forbiddenService.removeMember('member-user', 'trip-1', 'owner-1')).rejects.toMatchObject({ status: 403 });

    const ownerRepository = seedRepository();
    const ownerService = new TripService(ownerRepository, sequenceIds('unused'), () => 'unused');
    await ownerService.removeMember('owner-user', 'trip-1', 'member-1');
    expect(ownerRepository.memberships.has('member-1')).toBe(true);
    expect(ownerRepository.memberships.get('member-1')?.status).toBe('left');
  });

  it('transfers ownership to the earliest connected active successor before the owner leaves', async () => {
    const repository = seedRepository();
    repository.memberships.get('member-1')!.createdAt = new Date('2026-08-02T00:00:00.000Z');
    repository.memberships.set('member-0', {
      id: 'member-0', tripId: 'trip-1', firebaseUid: 'earliest-user', name: 'Early', role: 'member',
      status: 'active', createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    repository.memberships.set('member-anonymous', {
      id: 'member-anonymous', tripId: 'trip-1', firebaseUid: null, name: 'Anonymous', role: 'member',
      status: 'active', createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    const service = new TripService(repository, sequenceIds('unused'), () => 'unused');

    await service.removeMember('owner-user', 'trip-1', 'owner-1');

    expect(repository.memberships.get('owner-1')).toMatchObject({ role: 'member', status: 'left' });
    expect(repository.memberships.get('member-0')).toMatchObject({ role: 'owner', status: 'active' });
    expect(repository.trips.get('trip-1')?.ownerMembershipId).toBe('member-0');
  });

  it('rejects a voluntary owner leave when no connected active successor exists', async () => {
    const repository = seedRepository();
    repository.memberships.get('member-1')!.status = 'left';
    const service = new TripService(repository, sequenceIds('unused'), () => 'unused');

    await expect(service.removeMember('owner-user', 'trip-1', 'owner-1'))
      .rejects.toMatchObject({ status: 409 });
    expect(repository.memberships.get('owner-1')).toMatchObject({ role: 'owner', status: 'active' });
  });

  it('returns controlled validation errors for non-string trip fields', async () => {
    const service = new TripService(new MemoryTripRepository(), sequenceIds('unused'), () => 'unused');

    await expect(service.createTrip('firebase-1', null as unknown as string, 'Owner'))
      .rejects.toMatchObject({ status: 400 });
    await expect(service.joinTrip('firebase-1', 'ROOM42', { malformed: true } as unknown as string))
      .rejects.toMatchObject({ status: 400 });
  });
});
