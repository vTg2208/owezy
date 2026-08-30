export interface AccountUser {
  id: string;
  firebaseUid: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface UserTripSummary {
  id: string;
  name: string;
  roomCode: string;
  adminId: string;
  isLocked: boolean;
  createdAt: Date;
  memberId: string;
}

export interface AccountDeletionState {
  userExists: boolean;
  firebaseDeleted: boolean;
}

export interface AccountRepository {
  upsertUser(firebaseUid: string, email: string, name: string): Promise<AccountUser>;
  findUser(firebaseUid: string): Promise<AccountUser | null>;
  listUserTrips(firebaseUid: string): Promise<UserTripSummary[]>;
  beginAccountDeletion(firebaseUid: string): Promise<AccountDeletionState>;
  markFirebaseDeleted(firebaseUid: string): Promise<void>;
}

export interface FirebaseUserDeletion {
  deleteUser(uid: string): Promise<unknown>;
}

function isFirebaseUserNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'auth/user-not-found';
}

export class AccountService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly firebaseAuth: FirebaseUserDeletion,
  ) {}

  async syncUser(firebaseUid: string, email: string, name?: string): Promise<AccountUser> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name?.trim() || normalizedEmail.split('@')[0];
    return this.repository.upsertUser(firebaseUid, normalizedEmail, normalizedName);
  }

  findUser(firebaseUid: string): Promise<AccountUser | null> {
    return this.repository.findUser(firebaseUid);
  }

  listUserTrips(firebaseUid: string): Promise<UserTripSummary[]> {
    return this.repository.listUserTrips(firebaseUid);
  }

  async deleteAccount(firebaseUid: string): Promise<{ success: true }> {
    const state = await this.repository.beginAccountDeletion(firebaseUid);

    if (!state.firebaseDeleted) {
      try {
        await this.firebaseAuth.deleteUser(firebaseUid);
      } catch (error) {
        if (!isFirebaseUserNotFound(error)) throw error;
      }
      if (state.userExists) await this.repository.markFirebaseDeleted(firebaseUid);
    }

    return { success: true };
  }
}
