import type {
  InvitePrincipal,
  InviteRepository,
} from '../services/inviteService';
import type {
  PaymentCreateResult,
  PaymentRecord,
  PaymentRepository,
  PaymentState,
  PaymentTransitionResult,
} from '../services/paymentService';
import { generateId } from '../utils/helpers';
import {
  defaultDatabase,
  defaultTransaction,
  QueryExecutor,
  TransactionRunner,
} from './database';

export interface AuditEventRecord {
  id: string;
  actorMembershipId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

function mapPayment(row: Record<string, any>): PaymentRecord {
  return {
    id: row.id,
    status: row.status,
    payerMembershipId: row.payer_membership_id,
    payeeMembershipId: row.payee_membership_id,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency,
    note: row.note ?? null,
  };
}

export class PostgresFinancialRepository implements PaymentRepository, InviteRepository {
  constructor(
    private readonly database: QueryExecutor = defaultDatabase(),
    private readonly transaction: TransactionRunner = defaultTransaction,
    private readonly createId: () => string = generateId,
  ) {}

  private run<T>(database: QueryExecutor | undefined, work: (executor: QueryExecutor) => Promise<T>) {
    return database ? work(database) : this.transaction(work);
  }

  private async audit(
    database: QueryExecutor,
    actorMembershipId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown> = {},
  ) {
    await database.query(
      `INSERT INTO audit_events
         (id, actor_membership_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [this.createId(), actorMembershipId, action, entityType, entityId, JSON.stringify(metadata)],
    );
  }

  async findActiveMembershipId(firebaseUid: string, tripId: string): Promise<string | null> {
    const result = await this.database.query(
      `SELECT m.id
         FROM trip_memberships m
         JOIN users u ON u.id = m.user_id AND u.account_status = 'active'
        WHERE u.firebase_uid = $1 AND m.trip_id = $2 AND m.status = 'active'`,
      [firebaseUid, tripId],
    );
    return result.rows[0]?.id ?? null;
  }

  listPaymentsForMember(firebaseUid: string, tripId: string): Promise<PaymentRecord[] | null> {
    return this.transaction(async (executor) => {
      const authorized = await executor.query(
        `SELECT m.id FROM trip_memberships m
         JOIN users u ON u.id = m.user_id AND u.account_status = 'active'
         WHERE u.firebase_uid = $1 AND m.trip_id = $2 AND m.status = 'active'`,
        [firebaseUid, tripId],
      );
      if (!authorized.rows[0]) return null;
      const payments = await executor.query(
        `SELECT id, payer_membership_id, payee_membership_id, amount_minor, currency, note, status
           FROM payments
          WHERE trip_id = $1
          ORDER BY created_at DESC, id DESC`,
        [tripId],
      );
      return payments.rows.map(mapPayment);
    });
  }

  createForActor(
    firebaseUid: string,
    tripId: string,
    payment: { id: string; payeeMembershipId: string; amountMinor: bigint; note?: string },
    database?: QueryExecutor,
  ): Promise<PaymentCreateResult> {
    return this.run(database, async (executor) => {
      const actorResult = await executor.query(
        `SELECT actor.id, t.currency
           FROM trip_memberships actor
           JOIN users u ON u.id = actor.user_id AND u.account_status = 'active'
           JOIN trips t ON t.id = actor.trip_id
          WHERE u.firebase_uid = $1 AND actor.trip_id = $2 AND actor.status = 'active'
          FOR UPDATE OF actor`,
        [firebaseUid, tripId],
      );
      const actor = actorResult.rows[0];
      if (!actor) return { kind: 'forbidden' };

      const payee = await executor.query(
        `SELECT id FROM trip_memberships
          WHERE trip_id = $1 AND id = $2 AND status = 'active'
          FOR UPDATE`,
        [tripId, payment.payeeMembershipId],
      );
      if (payee.rowCount !== 1 || actor.id === payment.payeeMembershipId) {
        return { kind: 'invalid-payee' };
      }

      const inserted = await executor.query(
        `INSERT INTO payments
           (id, trip_id, payer_membership_id, payee_membership_id, amount_minor, currency, note, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING id, payer_membership_id, payee_membership_id, amount_minor, currency, note, status`,
        [
          payment.id, tripId, actor.id, payment.payeeMembershipId,
          payment.amountMinor, actor.currency, payment.note ?? null,
        ],
      );
      await this.audit(executor, actor.id, 'payment.created', 'payment', payment.id, {
        payeeMembershipId: payment.payeeMembershipId,
        amountMinor: payment.amountMinor.toString(),
        currency: actor.currency,
      });
      return { kind: 'created', payment: mapPayment(inserted.rows[0]) };
    });
  }

  transitionForActor(
    firebaseUid: string,
    tripId: string,
    paymentId: string,
    target: Exclude<PaymentState, 'pending'>,
    database?: QueryExecutor,
  ): Promise<PaymentTransitionResult> {
    return this.run(database, async (executor) => {
      const paymentResult = await executor.query(
        `SELECT p.id, p.status, p.payer_membership_id, p.payee_membership_id,
                p.amount_minor, p.currency, p.note, actor.id AS actor_id
           FROM payments p
           LEFT JOIN users u ON u.firebase_uid = $1 AND u.account_status = 'active'
           LEFT JOIN trip_memberships actor
             ON actor.user_id = u.id AND actor.trip_id = p.trip_id AND actor.status = 'active'
          WHERE p.id = $2 AND p.trip_id = $3
          FOR UPDATE OF p`,
        [firebaseUid, paymentId, tripId],
      );
      const current = paymentResult.rows[0];
      if (!current) return { kind: 'not-found' };
      if (!current.actor_id) return { kind: 'forbidden' };
      const requiredActor = target === 'cancelled'
        ? current.payer_membership_id
        : current.payee_membership_id;
      if (current.actor_id !== requiredActor) return { kind: 'forbidden' };
      if (current.status !== 'pending') return { kind: 'conflict' };

      const timestampColumn = target === 'confirmed'
        ? 'confirmed_at'
        : target === 'rejected' ? 'rejected_at' : 'cancelled_at';
      const actorColumn = target === 'confirmed'
        ? 'confirmed_by_membership_id'
        : target === 'rejected' ? 'rejected_by_membership_id' : 'cancelled_by_membership_id';
      const updated = await executor.query(
        `UPDATE payments
            SET status = $2, ${timestampColumn} = now(), ${actorColumn} = $3
          WHERE id = $1 AND status = 'pending'
          RETURNING id, payer_membership_id, payee_membership_id, amount_minor, currency, note, status`,
        [paymentId, target, current.actor_id],
      );
      if (updated.rowCount !== 1) return { kind: 'conflict' };
      await this.audit(executor, current.actor_id, `payment.${target}`, 'payment', paymentId, {
        previousStatus: 'pending', nextStatus: target,
      });
      return { kind: 'updated', payment: mapPayment(updated.rows[0]) };
    });
  }

  createForOwner(
    firebaseUid: string,
    tripId: string,
    invite: { id: string; email: string; tokenHash: string; expiresAt: Date },
    database?: QueryExecutor,
  ): Promise<{ kind: 'created'; inviteId: string } | { kind: 'forbidden' }> {
    return this.run(database, async (executor) => {
      const owner = await executor.query(
        `SELECT m.id
           FROM trip_memberships m
           JOIN users u ON u.id = m.user_id AND u.account_status = 'active'
          WHERE u.firebase_uid = $1 AND m.trip_id = $2
            AND m.status = 'active' AND m.role = 'owner'
          FOR UPDATE OF m`,
        [firebaseUid, tripId],
      );
      if (!owner.rows[0]) return { kind: 'forbidden' };
      const inserted = await executor.query(
        `INSERT INTO trip_invites
           (id, trip_id, email, invited_by_membership_id, status, expires_at, token_hash)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6)
         ON CONFLICT (trip_id, email) DO UPDATE
           SET invited_by_membership_id = EXCLUDED.invited_by_membership_id,
               status = 'pending', expires_at = EXCLUDED.expires_at, token_hash = EXCLUDED.token_hash,
               created_at = now()
         RETURNING id`,
        [invite.id, tripId, invite.email, owner.rows[0].id, invite.expiresAt, invite.tokenHash],
      );
      const inviteId = inserted.rows[0].id;
      await this.audit(executor, owner.rows[0].id, 'invite.created', 'invite', inviteId, {
        email: invite.email, expiresAt: invite.expiresAt.toISOString(),
      });
      return { kind: 'created', inviteId };
    });
  }

  revokeForOwner(
    firebaseUid: string,
    tripId: string,
    inviteId: string,
    database?: QueryExecutor,
  ): Promise<'revoked' | 'forbidden' | 'not-found' | 'conflict'> {
    return this.run(database, async (executor) => {
      const result = await executor.query(
        `SELECT i.id, i.status, owner.id AS actor_id
           FROM trip_invites i
           LEFT JOIN users u ON u.firebase_uid = $1 AND u.account_status = 'active'
           LEFT JOIN trip_memberships owner
             ON owner.user_id = u.id AND owner.trip_id = i.trip_id
            AND owner.status = 'active' AND owner.role = 'owner'
          WHERE i.id = $2 AND i.trip_id = $3
          FOR UPDATE OF i`,
        [firebaseUid, inviteId, tripId],
      );
      const invite = result.rows[0];
      if (!invite) return 'not-found';
      if (!invite.actor_id) return 'forbidden';
      if (invite.status !== 'pending') return 'conflict';
      await executor.query(`UPDATE trip_invites SET status = 'revoked' WHERE id = $1`, [inviteId]);
      await this.audit(executor, invite.actor_id, 'invite.revoked', 'invite', inviteId);
      return 'revoked';
    });
  }

  acceptForUser(
    principal: InvitePrincipal,
    tokenHash: string,
    membershipId: string,
    database?: QueryExecutor,
  ): Promise<
    | { kind: 'accepted'; tripId: string; membershipId: string }
    | { kind: 'not-found' | 'expired' | 'email-mismatch' | 'conflict' | 'account-missing' }
  > {
    return this.run(database, async (executor) => {
      const result = await executor.query(
        `SELECT id, trip_id, email, status, expires_at
           FROM trip_invites WHERE token_hash = $1 FOR UPDATE`,
        [tokenHash],
      );
      const invite = result.rows[0];
      if (!invite) return { kind: 'not-found' };
      if (String(invite.email).toLowerCase() !== principal.email.toLowerCase()) {
        return { kind: 'email-mismatch' };
      }
      const user = await executor.query(
        `SELECT id FROM users
          WHERE firebase_uid = $1 AND lower(email) = lower($2) AND account_status = 'active'
          FOR UPDATE`,
        [principal.uid, principal.email],
      );
      if (!user.rows[0]) return { kind: 'account-missing' };
      if (invite.status === 'accepted') {
        const accepted = await executor.query(
          `SELECT id FROM trip_memberships
            WHERE trip_id = $1 AND user_id = $2 AND status = 'active'`,
          [invite.trip_id, user.rows[0].id],
        );
        return accepted.rows[0]
          ? { kind: 'accepted', tripId: invite.trip_id, membershipId: accepted.rows[0].id }
          : { kind: 'conflict' };
      }
      if (invite.status !== 'pending') return { kind: 'conflict' };
      if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
        await executor.query(`UPDATE trip_invites SET status = 'expired' WHERE id = $1`, [invite.id]);
        return { kind: 'expired' };
      }
      const existing = await executor.query(
        `SELECT id, status FROM trip_memberships
          WHERE trip_id = $1 AND user_id = $2 FOR UPDATE`,
        [invite.trip_id, user.rows[0].id],
      );
      let acceptedMembershipId = existing.rows[0]?.id as string | undefined;
      if (acceptedMembershipId) {
        await executor.query(
          `UPDATE trip_memberships
              SET status = 'active', left_at = NULL
            WHERE id = $1 AND status = 'left'`,
          [acceptedMembershipId],
        );
      } else {
        const nameConflict = await executor.query(
          `SELECT EXISTS (
             SELECT 1 FROM trip_memberships
              WHERE trip_id = $1 AND status = 'active' AND lower(display_name) = lower($2)
           ) AS conflict`,
          [invite.trip_id, principal.name],
        );
        const displayName = nameConflict.rows[0]?.conflict
          ? `${principal.name} ${membershipId.slice(0, 4)}`
          : principal.name;
        await executor.query(
          `INSERT INTO trip_memberships
             (id, trip_id, user_id, display_name, role, status)
           VALUES ($1, $2, $3, $4, 'member', 'active')`,
          [membershipId, invite.trip_id, user.rows[0].id, displayName],
        );
        acceptedMembershipId = membershipId;
      }
      await executor.query(`UPDATE trip_invites SET status = 'accepted' WHERE id = $1`, [invite.id]);
      await this.audit(executor, acceptedMembershipId!, 'invite.accepted', 'invite', invite.id, {
        tripId: invite.trip_id,
      });
      return { kind: 'accepted', tripId: invite.trip_id, membershipId: acceptedMembershipId! };
    });
  }

  listAuditForMember(firebaseUid: string, tripId: string, limit = 100): Promise<AuditEventRecord[] | null> {
    return this.transaction(async (executor) => {
      const boundedLimit = Number.isSafeInteger(limit) && limit > 0
        ? Math.min(limit, 200)
        : 100;
      const authorized = await executor.query(
        `SELECT m.id FROM trip_memberships m
         JOIN users u ON u.id = m.user_id AND u.account_status = 'active'
         WHERE u.firebase_uid = $1 AND m.trip_id = $2 AND m.status = 'active'`,
        [firebaseUid, tripId],
      );
      if (!authorized.rows[0]) return null;
      const events = await executor.query(
        `SELECT e.id, e.actor_membership_id, e.action, e.entity_type, e.entity_id,
                e.metadata, e.created_at
           FROM audit_events e
           JOIN trip_memberships actor ON actor.id = e.actor_membership_id
          WHERE actor.trip_id = $1
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT $2`,
        [tripId, boundedLimit],
      );
      return events.rows.map((row) => ({
        id: row.id,
        actorMembershipId: row.actor_membership_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        metadata: row.metadata,
        createdAt: row.created_at,
      }));
    });
  }
}
