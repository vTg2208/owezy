import { describe, expect, it } from 'vitest';
import {
  AccountDeletionState,
  AccountRepository,
  AccountService,
  AccountUser,
  UserTripSummary,
} from './accountService';

class MemoryAccountRepository implements AccountRepository {
  readonly users = new Map<string, AccountUser & { status: 'active' | 'deleting' | 'deleted' }>();
  readonly memberships = new Map<string, {
    firebaseUid: string | null;
    tripId: string;
    displayName: string;
    role: 'owner' | 'member';
    status: 'active' | 'anonymized';
    createdAt: Date;
  }>();
  readonly tripOwners = new Map<string, string>();
  readonly archivedTrips = new Set<string>();

  async upsertUser(firebaseUid: string, email: string, name: string): Promise<AccountUser> {
    const current = this.users.get(firebaseUid);
    const user = {
      id: current?.id ?? `user-${this.users.size + 1}`,
      firebaseUid,
      email,
      name,
      createdAt: current?.createdAt ?? new Date('2026-08-31T00:00:00.000Z'),
      status: current?.status ?? 'active' as const,
    };
    this.users.set(firebaseUid, user);
    return user;
  }

  async findUser(firebaseUid: string): Promise<AccountUser | null> {
    return this.users.get(firebaseUid) ?? null;
  }

  async listUserTrips(_firebaseUid: string): Promise<UserTripSummary[]> {
    return [];
  }

  async beginAccountDeletion(firebaseUid: string): Promise<AccountDeletionState> {
    const user = this.users.get(firebaseUid);
    if (!user) return { userExists: false, firebaseDeleted: false };

    user.email = `deleted+${user.id}@anonymized.invalid`;
    user.name = 'Deleted user';
    user.status = user.status === 'deleted' ? 'deleted' : 'deleting';
    for (const [membershipId, membership] of this.memberships) {
      if (membership.firebaseUid !== firebaseUid || membership.role !== 'owner') continue;
      const successor = [...this.memberships.entries()]
        .filter(([, candidate]) => candidate.tripId === membership.tripId
          && candidate.status === 'active'
          && candidate.firebaseUid !== firebaseUid)
        .sort((left, right) => left[1].createdAt.getTime() - right[1].createdAt.getTime()
          || left[0].localeCompare(right[0]))[0];
      if (successor) {
        membership.role = 'member';
        successor[1].role = 'owner';
        this.tripOwners.set(membership.tripId, successor[0]);
      } else {
        this.tripOwners.set(membership.tripId, membershipId);
        this.archivedTrips.add(membership.tripId);
      }
    }
    for (const membership of this.memberships.values()) {
      if (membership.firebaseUid === firebaseUid) {
        membership.firebaseUid = null;
        membership.displayName = `Former member ${[...this.memberships.entries()]
          .find(([, candidate]) => candidate === membership)?.[0]}`;
        membership.status = 'anonymized';
      }
    }
    return { userExists: true, firebaseDeleted: user.status === 'deleted' };
  }

  async markFirebaseDeleted(firebaseUid: string): Promise<void> {
    const user = this.users.get(firebaseUid);
    if (user) user.status = 'deleted';
  }
}

class MemoryFirebaseAuth {
  readonly deletedUids = new Set<string>();
  failWithNotFound = false;
  postgresWasAnonymized = false;

  async deleteUser(uid: string): Promise<void> {
    if (!this.postgresWasAnonymized) throw new Error('Firebase called before PostgreSQL anonymization');
    if (this.failWithNotFound) {
      const error = new Error('missing') as Error & { code: string };
      error.code = 'auth/user-not-found';
      throw error;
    }
    this.deletedUids.add(uid);
  }
}

describe('AccountService', () => {
  it('upserts a user by Firebase UID and normalizes the email', async () => {
    const repository = new MemoryAccountRepository();
    const service = new AccountService(repository, new MemoryFirebaseAuth());

    const first = await service.syncUser('firebase-1', ' Person@Example.COM ', 'First name');
    const second = await service.syncUser('firebase-1', 'person@example.com', 'Updated name');

    expect(first.id).toBe(second.id);
    expect(second).toMatchObject({
      firebaseUid: 'firebase-1',
      email: 'person@example.com',
      name: 'Updated name',
    });
    expect(repository.users).toHaveLength(1);
  });

  it('anonymizes PostgreSQL identity and memberships before deleting Firebase', async () => {
    const repository = new MemoryAccountRepository();
    await repository.upsertUser('firebase-1', 'person@example.com', 'Person');
    repository.memberships.set('member-1', {
      firebaseUid: 'firebase-1', tripId: 'trip-1', displayName: 'Person', role: 'owner', status: 'active',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    repository.memberships.set('member-2', {
      firebaseUid: 'firebase-2', tripId: 'trip-1', displayName: 'Successor', role: 'member', status: 'active',
      createdAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    repository.tripOwners.set('trip-1', 'member-1');
    const firebase = new MemoryFirebaseAuth();
    const service = new AccountService(repository, {
      async deleteUser(uid) {
        firebase.postgresWasAnonymized = repository.memberships.get('member-1')?.status === 'anonymized'
          && repository.memberships.get('member-2')?.role === 'owner'
          && repository.tripOwners.get('trip-1') === 'member-2';
        await firebase.deleteUser(uid);
      },
    });

    await service.deleteAccount('firebase-1');

    expect(repository.users.get('firebase-1')).toMatchObject({
      email: 'deleted+user-1@anonymized.invalid',
      name: 'Deleted user',
      status: 'deleted',
    });
    expect(repository.memberships.get('member-1')).toEqual({
      firebaseUid: null,
      tripId: 'trip-1',
      displayName: 'Former member member-1',
      role: 'member',
      status: 'anonymized',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(repository.memberships.get('member-2')).toMatchObject({ role: 'owner', status: 'active' });
    expect(repository.tripOwners.get('trip-1')).toBe('member-2');
    expect(firebase.deletedUids.has('firebase-1')).toBe(true);
  });

  it('treats an already-missing Firebase user as a successful deletion retry', async () => {
    const repository = new MemoryAccountRepository();
    await repository.upsertUser('firebase-1', 'person@example.com', 'Person');
    const firebase = new MemoryFirebaseAuth();
    firebase.postgresWasAnonymized = true;
    firebase.failWithNotFound = true;
    const service = new AccountService(repository, firebase);

    await expect(service.deleteAccount('firebase-1')).resolves.toEqual({ success: true });
    expect(repository.users.get('firebase-1')?.status).toBe('deleted');
  });

  it('archives an owned trip when deleting the only connected account', async () => {
    const repository = new MemoryAccountRepository();
    await repository.upsertUser('firebase-1', 'person@example.com', 'Person');
    repository.memberships.set('owner-1', {
      firebaseUid: 'firebase-1', tripId: 'trip-1', displayName: 'Person', role: 'owner', status: 'active',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    repository.tripOwners.set('trip-1', 'owner-1');
    const firebase = new MemoryFirebaseAuth();
    firebase.postgresWasAnonymized = true;

    await new AccountService(repository, firebase).deleteAccount('firebase-1');

    expect(repository.archivedTrips.has('trip-1')).toBe(true);
    expect(repository.memberships.get('owner-1')).toMatchObject({
      firebaseUid: null, role: 'owner', status: 'anonymized',
    });
  });
});
