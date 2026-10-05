import { ServiceError } from '../services/errors';
import {
  JoinResult,
  Membership,
  MembershipRole,
  MembershipStatus,
  TripDetails,
  TripExpensePage,
  TripExpenseSummary,
  TripRecord,
  TripRepository,
} from '../services/tripService';
import {
  defaultDatabase,
  defaultTransaction,
  QueryExecutor,
  TransactionRunner,
} from './database';

function mapTrip(row: Record<string, any>, prefix = ''): TripRecord {
  return {
    id: row[`${prefix}id`] ?? row.trip_id,
    name: row[`${prefix}name`] ?? row.trip_name,
    roomCode: row[`${prefix}room_code`] ?? row.room_code,
    ownerMembershipId: row[`${prefix}owner_membership_id`] ?? row.owner_membership_id,
    isLocked: row[`${prefix}is_locked`] ?? row.is_locked,
    createdAt: row[`${prefix}created_at`] ?? row.trip_created_at,
    ...((row[`${prefix}currency`] ?? row.currency)
      ? { currency: row[`${prefix}currency`] ?? row.currency }
      : {}),
  };
}

function mapMembership(row: Record<string, any>, firebaseUid?: string | null, prefix = ''): Membership {
  return {
    id: row[`${prefix}id`],
    tripId: row[`${prefix}trip_id`] ?? row.trip_id,
    firebaseUid: firebaseUid ?? row[`${prefix}firebase_uid`] ?? null,
    name: row[`${prefix}display_name`] ?? row[`${prefix}name`],
    role: row[`${prefix}role`] as MembershipRole,
    status: row[`${prefix}status`] as MembershipStatus,
    createdAt: row[`${prefix}created_at`],
  };
}

const EXPENSE_PAGE_SIZE = 50;

function mapExpense(row: Record<string, any>): TripExpenseSummary {
  return {
    id: row.id,
    tripId: row.trip_id,
    paidBy: row.paid_by_membership_id,
    paidByName: row.paid_by_name,
    description: row.description,
    amountMinor: BigInt(row.total_minor),
    splitType: row.split_type,
    ...(row.expense_key ? { expenseKey: row.expense_key } : {}),
    ...(row.version !== undefined ? { version: Number(row.version) } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.currency ? { currency: row.currency } : {}),
    ...(row.receipt_id ? {
      receiptUrl: `/api/trips/${encodeURIComponent(row.trip_id)}/receipts/${encodeURIComponent(row.receipt_id)}`,
    } : {}),
    createdAt: row.created_at,
  };
}

function encodeExpenseCursor(row: Record<string, any>): string {
  return Buffer.from(JSON.stringify([new Date(row.created_at).toISOString(), row.id])).toString('base64url');
}

function decodeExpenseCursor(cursor: string): [Date, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string') throw new Error();
    const createdAt = new Date(value[0]);
    if (Number.isNaN(createdAt.getTime()) || !value[1]) throw new Error();
    return [createdAt, value[1]];
  } catch {
    throw new ServiceError(400, 'Invalid expense cursor');
  }
}

function expensePage(rows: Array<Record<string, any>>): TripExpensePage {
  const visible = rows.slice(0, EXPENSE_PAGE_SIZE);
  return {
    expenses: visible.map(mapExpense),
    ...(rows.length > EXPENSE_PAGE_SIZE ? { nextCursor: encodeExpenseCursor(visible[visible.length - 1]) } : {}),
  };
}

export class PostgresTripRepository implements TripRepository {
  constructor(
    private readonly database: QueryExecutor = defaultDatabase(),
    private readonly transaction: TransactionRunner = defaultTransaction,
  ) {}

  createTripForUser(
    firebaseUid: string,
    trip: TripRecord,
    owner: Membership,
  ): Promise<{ trip: TripRecord; owner: Membership }> {
    return this.transaction(async (database) => {
      const userResult = await database.query(
        `SELECT id FROM users WHERE firebase_uid = $1 AND account_status = 'active' FOR UPDATE`,
        [firebaseUid],
      );
      const user = userResult.rows[0];
      if (!user) throw new ServiceError(404, 'User not found');

      await database.query(
        `INSERT INTO trips (id, name, room_code, owner_membership_id, is_locked, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [trip.id, trip.name, trip.roomCode, owner.id, trip.isLocked, trip.createdAt],
      );
      await database.query(
        `INSERT INTO trip_memberships
           (id, trip_id, user_id, display_name, role, status, created_at)
         VALUES ($1, $2, $3, $4, 'owner', 'active', $5)`,
        [owner.id, trip.id, user.id, owner.name, owner.createdAt],
      );
      return { trip, owner };
    });
  }

  joinTripForUser(
    firebaseUid: string,
    roomCode: string,
    displayName: string,
    membershipId: string,
  ): Promise<JoinResult> {
    return this.transaction(async (database) => {
      const activeUser = await database.query(
        `SELECT id FROM users WHERE firebase_uid = $1 AND account_status = 'active' FOR UPDATE`,
        [firebaseUid],
      );
      if (!activeUser.rows[0]) return { kind: 'not-found' };
      const result = await database.query(
        `SELECT t.id AS trip_id,
                t.name AS trip_name,
                t.room_code,
                t.owner_membership_id,
                t.is_locked,
                t.created_at AS trip_created_at,
                u.id AS user_id,
                existing.id AS existing_id,
                existing.display_name AS existing_name,
                existing.role AS existing_role,
                existing.status AS existing_status,
                existing.created_at AS existing_created_at,
                EXISTS (
                  SELECT 1
                    FROM trip_memberships m
                   WHERE m.trip_id = t.id
                     AND m.status = 'active'
                     AND lower(m.display_name) = lower($3)
                     AND m.id IS DISTINCT FROM existing.id
                ) AS name_conflict
           FROM trips t
           JOIN users u ON u.id = $2 AND u.account_status = 'active'
           LEFT JOIN trip_memberships existing
             ON existing.trip_id = t.id AND existing.user_id = u.id
          WHERE upper(t.room_code) = $1
            AND t.archived_at IS NULL
          FOR UPDATE OF t`,
        [roomCode, activeUser.rows[0].id, displayName],
      );
      const row = result.rows[0];
      if (!row) return { kind: 'not-found' };
      if (row.is_locked) return { kind: 'locked' };

      const trip = mapTrip(row);
      if (row.existing_id && row.existing_status === 'active') {
        return {
          kind: 'existing',
          trip,
          membership: {
            id: row.existing_id,
            tripId: row.trip_id,
            firebaseUid,
            name: row.existing_name,
            role: row.existing_role,
            status: row.existing_status,
            createdAt: row.existing_created_at,
          },
        };
      }
      if (row.name_conflict) return { kind: 'name-conflict' };

      let membershipRow: Record<string, any>;
      if (row.existing_id) {
        const reactivated = await database.query(
          `UPDATE trip_memberships
              SET display_name = $2,
                  status = 'active',
                  left_at = NULL
            WHERE id = $1
            RETURNING id, trip_id, display_name, role, status, created_at`,
          [row.existing_id, displayName],
        );
        membershipRow = reactivated.rows[0];
      } else {
        const inserted = await database.query(
          `INSERT INTO trip_memberships (id, trip_id, user_id, display_name, role, status)
           VALUES ($1, $2, $3, $4, 'member', 'active')
           RETURNING id, trip_id, display_name, role, status, created_at`,
          [membershipId, row.trip_id, row.user_id, displayName],
        );
        membershipRow = inserted.rows[0];
      }

      return {
        kind: 'joined',
        trip,
        membership: mapMembership(membershipRow, firebaseUid),
      };
    });
  }

  async findActiveMembership(firebaseUid: string, tripId: string): Promise<Membership | null> {
    const result = await this.database.query(
      `SELECT m.id, m.trip_id, u.firebase_uid, m.display_name, m.role, m.status, m.created_at
         FROM trip_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE u.firebase_uid = $1
          AND u.account_status = 'active'
          AND m.trip_id = $2
          AND m.status = 'active'`,
      [firebaseUid, tripId],
    );
    return result.rows[0] ? mapMembership(result.rows[0]) : null;
  }

  getTripDetailsForMember(firebaseUid: string, tripId: string): Promise<TripDetails | null> {
    return this.transaction(async (database) => {
      const authorization = await database.query(
        `SELECT t.id, t.name, t.room_code, t.owner_membership_id, t.is_locked, t.currency,
                t.created_at, m.id AS current_membership_id
           FROM trips t
           JOIN trip_memberships m ON m.trip_id = t.id AND m.status = 'active'
           JOIN users u ON u.id = m.user_id
          WHERE t.id = $1 AND u.firebase_uid = $2 AND u.account_status = 'active'`,
        [tripId, firebaseUid],
      );
      if (!authorization.rows[0]) return null;

      const [membersResult, expensesResult] = await Promise.all([
        database.query(
          `SELECT m.id, m.trip_id, u.firebase_uid, m.display_name, m.role, m.status, m.created_at
             FROM trip_memberships m
             LEFT JOIN users u ON u.id = m.user_id
            WHERE m.trip_id = $1 AND m.status = 'active'
            ORDER BY m.created_at, m.id`,
          [tripId],
        ),
        database.query(
          `SELECT e.id,
                  e.trip_id,
                  e.paid_by_membership_id,
                  payer.display_name AS paid_by_name,
                  e.description,
                  e.total_minor,
                  e.currency,
                  e.split_type,
                  e.expense_key,
                  e.version,
                  e.status,
                  receipt.id AS receipt_id,
                  e.created_at
             FROM expenses e
             JOIN trip_memberships payer ON payer.id = e.paid_by_membership_id
             LEFT JOIN receipts receipt
               ON receipt.expense_id = e.id
              AND receipt.trip_id = e.trip_id
              AND receipt.status = 'attached'
            WHERE e.trip_id = $1 AND e.status = 'active'
            ORDER BY e.created_at DESC, e.id DESC
            LIMIT $2`,
          [tripId, EXPENSE_PAGE_SIZE + 1],
        ),
      ]);

      const firstExpensePage = expensePage(expensesResult.rows);
      return {
        trip: mapTrip(authorization.rows[0]),
        participants: membersResult.rows.map((row) => mapMembership(row)),
        expenses: firstExpensePage.expenses,
        ...(firstExpensePage.nextCursor ? { expenseNextCursor: firstExpensePage.nextCursor } : {}),
        ...(authorization.rows[0].current_membership_id
          ? { currentMembershipId: authorization.rows[0].current_membership_id }
          : {}),
      };
    });
  }

  getExpensePageForMember(firebaseUid: string, tripId: string, cursor?: string): Promise<TripExpensePage | null> {
    return this.transaction(async (database) => {
      const membership = await database.query(
        `SELECT 1
           FROM trip_memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.trip_id = $1 AND u.firebase_uid = $2 AND u.account_status = 'active' AND m.status = 'active'`,
        [tripId, firebaseUid],
      );
      if (!membership.rows[0]) return null;
      const [cursorCreatedAt, cursorId] = cursor ? decodeExpenseCursor(cursor) : [null, null];
      const result = await database.query(
        `SELECT e.id, e.trip_id, e.paid_by_membership_id, payer.display_name AS paid_by_name,
                e.description, e.total_minor, e.currency, e.split_type, e.expense_key,
                e.version, e.status, receipt.id AS receipt_id, e.created_at
           FROM expenses e
           JOIN trip_memberships payer ON payer.id = e.paid_by_membership_id
           LEFT JOIN receipts receipt
             ON receipt.expense_id = e.id AND receipt.trip_id = e.trip_id AND receipt.status = 'attached'
          WHERE e.trip_id = $1 AND e.status = 'active'
            AND ($2::timestamptz IS NULL OR (e.created_at, e.id) < ($2::timestamptz, $3::text))
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT $4`,
        [tripId, cursorCreatedAt, cursorId, EXPENSE_PAGE_SIZE + 1],
      );
      return expensePage(result.rows);
    });
  }

  async setTripLockedForOwner(
    firebaseUid: string,
    tripId: string,
    locked: boolean,
  ): Promise<'updated' | 'forbidden' | 'not-found'> {
    const updated = await this.database.query(
      `UPDATE trips t
          SET is_locked = $3, updated_at = now()
         FROM trip_memberships actor
         JOIN users u ON u.id = actor.user_id
        WHERE t.id = $2
          AND t.owner_membership_id = actor.id
          AND actor.trip_id = t.id
          AND actor.status = 'active'
          AND actor.role = 'owner'
          AND u.account_status = 'active'
          AND u.firebase_uid = $1
        RETURNING t.id`,
      [firebaseUid, tripId, locked],
    );
    if (updated.rowCount === 1) return 'updated';
    const existence = await this.database.query(
      `SELECT EXISTS (SELECT 1 FROM trips WHERE id = $1) AS trip_exists`,
      [tripId],
    );
    return existence.rows[0]?.trip_exists ? 'forbidden' : 'not-found';
  }

  removeMemberForActor(
    firebaseUid: string,
    tripId: string,
    membershipId: string,
  ): Promise<'removed' | 'forbidden' | 'not-found' | 'owner-required'> {
    return this.transaction(async (database) => {
      const trip = await database.query(
        `SELECT id FROM trips WHERE id = $1 FOR UPDATE`,
        [tripId],
      );
      if (trip.rowCount !== 1) return 'not-found';

      const actorResult = await database.query(
        `SELECT actor.id AS actor_id, actor.role AS actor_role
           FROM trip_memberships actor
           JOIN users u ON u.id = actor.user_id
          WHERE actor.trip_id = $2
            AND actor.status = 'active'
            AND u.account_status = 'active'
            AND u.firebase_uid = $1
          FOR UPDATE OF actor`,
        [firebaseUid, tripId],
      );
      const actor = actorResult.rows[0];
      if (!actor) return 'forbidden';

      const targetResult = await database.query(
        `SELECT id, role, status
           FROM trip_memberships
          WHERE trip_id = $1 AND id = $2
          FOR UPDATE`,
        [tripId, membershipId],
      );
      const target = targetResult.rows[0];
      if (!target || target.status !== 'active') return 'not-found';
      if (actor.actor_id !== target.id && actor.actor_role !== 'owner') return 'forbidden';

      const leaveResult = await database.query(
        `SELECT leave_trip_membership($1, false) AS outcome`,
        [membershipId],
      );
      const outcome = leaveResult.rows[0]?.outcome;
      if (outcome === 'owner-required') return 'owner-required';
      if (outcome !== 'left') return 'not-found';
      return 'removed';
    });
  }
}
