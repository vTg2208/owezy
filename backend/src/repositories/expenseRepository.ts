import {
  BalanceLedger,
  ExpenseLifecycleResult,
  ExpenseRepository,
  ExpenseRevision,
  LedgerExpense,
  LedgerMembership,
  NewExpense,
} from '../services/expenseService';
import { ServiceError } from '../services/errors';
import { generateId } from '../utils/helpers';
import {
  defaultDatabase,
  defaultTransaction,
  QueryExecutor,
  TransactionRunner,
} from './database';

function mapMembership(row: Record<string, any>): LedgerMembership {
  return {
    id: row.id,
    tripId: row.trip_id,
    firebaseUid: row.firebase_uid ?? null,
    name: row.display_name,
    status: row.status,
  };
}

export class PostgresExpenseRepository implements ExpenseRepository {
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
    expenseId: string,
    metadata: Record<string, unknown>,
  ) {
    await database.query(
      `INSERT INTO audit_events
         (id, actor_membership_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, 'expense', $4, $5::jsonb)`,
      [this.createId(), actorMembershipId, action, expenseId, JSON.stringify(metadata)],
    );
  }

  async findActiveMembership(firebaseUid: string, tripId: string, database?: QueryExecutor): Promise<LedgerMembership | null> {
    const result = await (database ?? this.database).query(
      `SELECT m.id, m.trip_id, u.firebase_uid, m.display_name, m.status
         FROM trip_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE u.firebase_uid = $1 AND u.account_status = 'active' AND m.trip_id = $2 AND m.status = 'active'`,
      [firebaseUid, tripId],
    );
    return result.rows[0] ? mapMembership(result.rows[0]) : null;
  }

  async listActiveMemberships(tripId: string, database?: QueryExecutor): Promise<LedgerMembership[]> {
    const result = await (database ?? this.database).query(
      `SELECT m.id, m.trip_id, u.firebase_uid, m.display_name, m.status
         FROM trip_memberships m
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.trip_id = $1 AND m.status = 'active'
        ORDER BY m.created_at, m.id`,
      [tripId],
    );
    return result.rows.map(mapMembership);
  }

  async createExpense(expense: NewExpense, database?: QueryExecutor): Promise<void> {
    return this.run(database, async (database) => {
      const membershipIds = [...new Set([
        expense.paidByMembershipId,
        ...expense.splits.map((split) => split.membershipId),
      ])];
      const activeMemberships = await database.query(
        `SELECT id FROM trip_memberships
          WHERE trip_id = $1
            AND id = ANY($2::text[])
            AND status = 'active'
          FOR UPDATE`,
        [expense.tripId, membershipIds],
      );
      if (activeMemberships.rows.length !== membershipIds.length) {
        throw new ServiceError(400, 'Every payer and split member must still be active');
      }

      if (expense.receiptId) {
        const receipt = await database.query(
          `SELECT id FROM receipts
            WHERE id = $1
              AND trip_id = $2
              AND uploaded_by_membership_id = $3
              AND status = 'pending'
              AND pending_expires_at > now()
            FOR UPDATE`,
          [expense.receiptId, expense.tripId, expense.paidByMembershipId],
        );
        if (receipt.rows.length !== 1) {
          throw new ServiceError(400, 'Receipt is not attachable by this member for this trip');
        }
      }

      await database.query(
        `INSERT INTO expenses
           (id, trip_id, paid_by_membership_id, description, total_minor, currency, split_type,
            expense_key, version, status)
         SELECT $1, $2, $3, $4, $5, t.currency, $6, $1, 1, 'active'
           FROM trips t WHERE t.id = $2`,
        [
          expense.id,
          expense.tripId,
          expense.paidByMembershipId,
          expense.description,
          expense.totalMinor,
          expense.splitType,
        ],
      );

      const placeholders = expense.splits.map((_, index) => {
        const offset = index * 4;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
      });
      const values = expense.splits.flatMap((split) => [
        expense.id,
        expense.tripId,
        split.membershipId,
        split.amountMinor,
      ]);
      await database.query(
        `INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor)
         VALUES ${placeholders.join(', ')}`,
        values,
      );

      if (expense.receiptId) {
        await database.query(
          `UPDATE receipts
              SET expense_id = $2,
                  status = 'attached',
                  pending_expires_at = NULL,
                  attached_at = now()
            WHERE id = $1 AND status = 'pending'`,
          [expense.receiptId, expense.id],
        );
      }
      await this.audit(database, expense.paidByMembershipId, 'expense.created', expense.id, {
        version: 1,
        amountMinor: expense.totalMinor.toString(),
        splitType: expense.splitType,
      });
    });
  }

  correctExpenseForActor(
    firebaseUid: string,
    tripId: string,
    expenseId: string,
    expectedVersion: number,
    replacement: ExpenseRevision,
    database?: QueryExecutor,
  ): Promise<ExpenseLifecycleResult> {
    return this.run(database, async (executor) => {
      const locked = await executor.query(
        `SELECT e.id, e.expense_key, e.version, e.status, e.paid_by_membership_id,
                e.currency, actor.id AS actor_id, actor.role AS actor_role
           FROM expenses e
           LEFT JOIN users u ON u.firebase_uid = $1 AND u.account_status = 'active'
           LEFT JOIN trip_memberships actor
             ON actor.user_id = u.id AND actor.trip_id = e.trip_id AND actor.status = 'active'
          WHERE e.id = $2 AND e.trip_id = $3
          FOR UPDATE OF e`,
        [firebaseUid, expenseId, tripId],
      );
      const current = locked.rows[0];
      if (!current) return { kind: 'not-found' };
      if (!current.actor_id
        || (current.actor_id !== current.paid_by_membership_id && current.actor_role !== 'owner')) {
        return { kind: 'forbidden' };
      }
      if (current.status !== 'active' || Number(current.version) !== expectedVersion) {
        return { kind: 'conflict' };
      }
      const membershipIds = [...new Set(replacement.splits.map((split) => split.membershipId))];
      const active = await executor.query(
        `SELECT id FROM trip_memberships
          WHERE trip_id = $1 AND id = ANY($2::text[]) AND status = 'active'
          FOR UPDATE`,
        [tripId, membershipIds],
      );
      if (active.rows.length !== membershipIds.length) {
        throw new ServiceError(400, 'Every split member must still be active');
      }
      if (replacement.receiptId) {
        const receipt = await executor.query(
          `SELECT id FROM receipts
            WHERE id = $1 AND trip_id = $2 AND uploaded_by_membership_id = $3
              AND status = 'pending' AND pending_expires_at > now()
            FOR UPDATE`,
          [replacement.receiptId, tripId, current.actor_id],
        );
        if (receipt.rowCount !== 1) {
          throw new ServiceError(400, 'Receipt is not attachable by this member for this trip');
        }
      }
      await executor.query(
        `UPDATE expenses SET status = 'voided', voided_at = now()
          WHERE id = $1 AND status = 'active' AND version = $2`,
        [expenseId, expectedVersion],
      );
      const nextVersion = expectedVersion + 1;
      await executor.query(
        `INSERT INTO expenses
           (id, trip_id, paid_by_membership_id, description, total_minor, currency, split_type,
            expense_key, version, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
        [
          replacement.id, tripId, current.paid_by_membership_id, replacement.description,
          replacement.totalMinor, current.currency, replacement.splitType,
          current.expense_key, nextVersion,
        ],
      );
      const placeholders = replacement.splits.map((_, index) => {
        const offset = index * 4;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
      });
      await executor.query(
        `INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor)
         VALUES ${placeholders.join(', ')}`,
        replacement.splits.flatMap((split) => [
          replacement.id, tripId, split.membershipId, split.amountMinor,
        ]),
      );
      if (replacement.receiptId) {
        await executor.query(
          `UPDATE receipts
              SET expense_id = $2, status = 'attached', pending_expires_at = NULL, attached_at = now()
            WHERE id = $1 AND status = 'pending'`,
          [replacement.receiptId, replacement.id],
        );
      }
      await this.audit(executor, current.actor_id, 'expense.corrected', replacement.id, {
        expenseKey: current.expense_key,
        previousExpenseId: expenseId,
        previousVersion: expectedVersion,
        version: nextVersion,
        amountMinor: replacement.totalMinor.toString(),
      });
      return {
        kind: 'updated', expenseId: replacement.id, expenseKey: current.expense_key,
        version: nextVersion, status: 'active',
      };
    });
  }

  voidExpenseForActor(
    firebaseUid: string,
    tripId: string,
    expenseId: string,
    expectedVersion: number,
    database?: QueryExecutor,
  ): Promise<ExpenseLifecycleResult> {
    return this.run(database, async (executor) => {
      const locked = await executor.query(
        `SELECT e.id, e.expense_key, e.version, e.status, e.paid_by_membership_id,
                actor.id AS actor_id, actor.role AS actor_role
           FROM expenses e
           LEFT JOIN users u ON u.firebase_uid = $1 AND u.account_status = 'active'
           LEFT JOIN trip_memberships actor
             ON actor.user_id = u.id AND actor.trip_id = e.trip_id AND actor.status = 'active'
          WHERE e.id = $2 AND e.trip_id = $3
          FOR UPDATE OF e`,
        [firebaseUid, expenseId, tripId],
      );
      const current = locked.rows[0];
      if (!current) return { kind: 'not-found' };
      if (!current.actor_id
        || (current.actor_id !== current.paid_by_membership_id && current.actor_role !== 'owner')) {
        return { kind: 'forbidden' };
      }
      if (current.status !== 'active' || Number(current.version) !== expectedVersion) {
        return { kind: 'conflict' };
      }
      const updated = await executor.query(
        `UPDATE expenses SET status = 'voided', voided_at = now()
          WHERE id = $1 AND status = 'active' AND version = $2`,
        [expenseId, expectedVersion],
      );
      if (updated.rowCount !== 1) return { kind: 'conflict' };
      await this.audit(executor, current.actor_id, 'expense.voided', expenseId, {
        expenseKey: current.expense_key, version: expectedVersion,
      });
      return {
        kind: 'updated', expenseId, expenseKey: current.expense_key,
        version: expectedVersion, status: 'voided',
      };
    });
  }

  getBalanceLedgerForMember(firebaseUid: string, tripId: string): Promise<BalanceLedger | null> {
    return this.transaction(async (database) => {
      const authorization = await database.query(
        `SELECT EXISTS (
           SELECT 1
             FROM trip_memberships m
             JOIN users u ON u.id = m.user_id
            WHERE u.firebase_uid = $1 AND u.account_status = 'active' AND m.trip_id = $2 AND m.status = 'active'
         ) AS authorized`,
        [firebaseUid, tripId],
      );
      if (!authorization.rows[0]?.authorized) return null;

      const [membersResult, expensesResult, paymentsResult] = await Promise.all([
        database.query(
          `SELECT m.id, m.trip_id, m.display_name, m.status
             FROM trip_memberships m
            WHERE m.trip_id = $1
            ORDER BY m.created_at, m.id`,
          [tripId],
        ),
        database.query(
          `SELECT e.id AS expense_id,
                  e.paid_by_membership_id,
                  e.total_minor,
                  s.membership_id,
                  s.amount_minor
             FROM expenses e
             JOIN expense_splits s ON s.expense_id = e.id
            WHERE e.trip_id = $1 AND e.status = 'active'
            ORDER BY e.created_at, e.id, s.membership_id`,
          [tripId],
        ),
        database.query(
          `SELECT p.payer_membership_id, p.payee_membership_id, p.amount_minor
             FROM payments p
            WHERE p.trip_id = $1 AND p.status = 'confirmed'
            ORDER BY p.paid_at, p.id`,
          [tripId],
        ),
      ]);

      const expenses = new Map<string, LedgerExpense>();
      for (const row of expensesResult.rows) {
        let expense = expenses.get(row.expense_id);
        if (!expense) {
          expense = {
            paidByMembershipId: row.paid_by_membership_id,
            totalMinor: BigInt(row.total_minor),
            splits: [],
          };
          expenses.set(row.expense_id, expense);
        }
        expense.splits.push({
          membershipId: row.membership_id,
          amountMinor: BigInt(row.amount_minor),
        });
      }

      return {
        memberships: membersResult.rows.map(mapMembership),
        expenses: [...expenses.values()],
        payments: paymentsResult.rows.map((row) => ({
          payerMembershipId: row.payer_membership_id,
          payeeMembershipId: row.payee_membership_id,
          amountMinor: BigInt(row.amount_minor),
          status: 'confirmed' as const,
        })),
      };
    });
  }
}
