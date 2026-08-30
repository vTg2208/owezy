import { randomUUID } from 'crypto';
import {
  AccountDeletionState,
  AccountRepository,
  AccountUser,
  UserTripSummary,
} from '../services/accountService';
import {
  defaultDatabase,
  defaultTransaction,
  QueryExecutor,
  TransactionRunner,
} from './database';

interface UserRow {
  id: string;
  firebase_uid: string;
  email: string;
  name: string;
  created_at: Date;
}

const ACCOUNT_DELETION_TRANSACTION_ATTEMPTS = 3;

function isPostgresDeadlock(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '40P01';
}

async function retryPostgresDeadlock<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= ACCOUNT_DELETION_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isPostgresDeadlock(error) || attempt === ACCOUNT_DELETION_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new Error('Account deletion transaction attempts exhausted');
}

function mapUser(row: UserRow): AccountUser {
  return {
    id: row.id,
    firebaseUid: row.firebase_uid,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
  };
}

export class PostgresAccountRepository implements AccountRepository {
  constructor(
    private readonly database: QueryExecutor = defaultDatabase(),
    private readonly transaction: TransactionRunner = defaultTransaction,
  ) {}

  async upsertUser(
    firebaseUid: string,
    email: string,
    name: string,
    internalId: string = randomUUID(),
  ): Promise<AccountUser> {
    const result = await this.database.query(
      `WITH upserted AS (
         INSERT INTO users (id, firebase_uid, email, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (firebase_uid) DO UPDATE
           SET email = EXCLUDED.email,
               name = EXCLUDED.name
           WHERE users.account_status = 'active'
         RETURNING id, firebase_uid, email, name, created_at
       )
       SELECT id, firebase_uid, email, name, created_at FROM upserted
       UNION ALL
       SELECT id, firebase_uid, email, name, created_at
         FROM users
        WHERE firebase_uid = $2 AND NOT EXISTS (SELECT 1 FROM upserted)
       LIMIT 1`,
      [internalId, firebaseUid, email, name],
    );
    return mapUser(result.rows[0] as UserRow);
  }

  async findUser(firebaseUid: string): Promise<AccountUser | null> {
    const result = await this.database.query(
      `SELECT id, firebase_uid, email, name, created_at
         FROM users
        WHERE firebase_uid = $1`,
      [firebaseUid],
    );
    return result.rows[0] ? mapUser(result.rows[0] as UserRow) : null;
  }

  async listUserTrips(firebaseUid: string): Promise<UserTripSummary[]> {
    const result = await this.database.query(
      `SELECT t.id,
              t.name,
              t.room_code,
              t.owner_membership_id,
              t.is_locked,
              t.created_at,
              m.id AS member_id
         FROM users u
         JOIN trip_memberships m ON m.user_id = u.id AND m.status = 'active'
         JOIN trips t ON t.id = m.trip_id
        WHERE u.firebase_uid = $1
        ORDER BY t.created_at DESC, t.id DESC`,
      [firebaseUid],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      roomCode: row.room_code,
      adminId: row.owner_membership_id,
      isLocked: row.is_locked,
      createdAt: row.created_at,
      memberId: row.member_id,
    }));
  }

  beginAccountDeletion(firebaseUid: string): Promise<AccountDeletionState> {
    return retryPostgresDeadlock(() => this.transaction(async (database) => {
      const result = await database.query(
        `SELECT id, account_status
           FROM users
          WHERE firebase_uid = $1
          FOR UPDATE`,
        [firebaseUid],
      );
      const user = result.rows[0];
      if (!user) return { userExists: false, firebaseDeleted: false };

      if (user.account_status !== 'deleted') {
        const ownerships = await database.query(
          `SELECT owner.id AS owner_membership_id,
                  owner.trip_id,
                  successor.id AS successor_membership_id
             FROM trip_memberships owner
             JOIN trips trip ON trip.id = owner.trip_id
             LEFT JOIN LATERAL (
               SELECT candidate.id
                 FROM trip_memberships candidate
                WHERE candidate.trip_id = owner.trip_id
                  AND candidate.id <> owner.id
                  AND candidate.user_id IS NOT NULL
                  AND candidate.status = 'active'
                ORDER BY candidate.created_at, candidate.id
                LIMIT 1
                FOR UPDATE
             ) successor ON true
            WHERE owner.user_id = $1
              AND owner.role = 'owner'
            ORDER BY owner.trip_id
            FOR UPDATE OF owner, trip`,
          [user.id],
        );

        for (const ownership of ownerships.rows) {
          if (!ownership.successor_membership_id) continue;

          const demoted = await database.query(
            `UPDATE trip_memberships
                SET role = 'member'
              WHERE id = $1
                AND trip_id = $2
                AND role = 'owner'`,
            [ownership.owner_membership_id, ownership.trip_id],
          );
          if (demoted.rowCount !== 1) {
            throw new Error(`Failed to demote owner for trip ${ownership.trip_id}`);
          }

          const promoted = await database.query(
            `UPDATE trip_memberships
                SET role = 'owner'
              WHERE id = $1
                AND trip_id = $2
                AND status = 'active'
                AND user_id IS NOT NULL
                AND role = 'member'`,
            [ownership.successor_membership_id, ownership.trip_id],
          );
          if (promoted.rowCount !== 1) {
            throw new Error(`Failed to promote successor for trip ${ownership.trip_id}`);
          }

          const relinked = await database.query(
            `UPDATE trips
                SET owner_membership_id = $2,
                    updated_at = now()
              WHERE id = $1
                AND owner_membership_id = $3`,
            [
              ownership.trip_id,
              ownership.successor_membership_id,
              ownership.owner_membership_id,
            ],
          );
          if (relinked.rowCount !== 1) {
            throw new Error(`Failed to link successor for trip ${ownership.trip_id}`);
          }
        }

        await database.query(
          `UPDATE trip_memberships
              SET user_id = NULL,
                  display_name = 'Former member ' || id,
                  status = 'anonymized',
                  left_at = NULL,
                  anonymized_at = COALESCE(anonymized_at, now())
            WHERE user_id = $1`,
          [user.id],
        );
        await database.query(
          `UPDATE users
              SET email = 'deleted+' || id::text || '@anonymized.invalid',
                  name = 'Deleted user',
                  account_status = 'deleting',
                  anonymized_at = COALESCE(anonymized_at, now())
            WHERE id = $1`,
          [user.id],
        );
      }

      return { userExists: true, firebaseDeleted: user.account_status === 'deleted' };
    }));
  }

  async markFirebaseDeleted(firebaseUid: string): Promise<void> {
    await this.database.query(
      `UPDATE users
          SET account_status = 'deleted',
              firebase_deleted_at = COALESCE(firebase_deleted_at, now())
        WHERE firebase_uid = $1`,
      [firebaseUid],
    );
  }
}
