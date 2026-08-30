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
    displayName: string;
    role: 'owner' | 'member';
    status: 'active' | 'anonymized';
  }>();

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
      firebaseUid: 'firebase-1', displayName: 'Person', role: 'member', status: 'active',
    });
    const firebase = new MemoryFirebaseAuth();
    const service = new AccountService(repository, {
      async deleteUser(uid) {
        firebase.postgresWasAnonymized = repository.memberships.get('member-1')?.status === 'anonymized';
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
      displayName: 'Former member member-1',
      role: 'member',
      status: 'anonymized',
    });
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
});
