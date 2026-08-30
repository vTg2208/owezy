import {
  BalanceLedger,
  ExpenseRepository,
  LedgerExpense,
  LedgerMembership,
  NewExpense,
} from '../services/expenseService';
import { ServiceError } from '../services/errors';
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
  ) {}

  async findActiveMembership(firebaseUid: string, tripId: string): Promise<LedgerMembership | null> {
    const result = await this.database.query(
      `SELECT m.id, m.trip_id, u.firebase_uid, m.display_name, m.status
         FROM trip_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE u.firebase_uid = $1 AND m.trip_id = $2 AND m.status = 'active'`,
      [firebaseUid, tripId],
    );
    return result.rows[0] ? mapMembership(result.rows[0]) : null;
  }

  async listActiveMemberships(tripId: string): Promise<LedgerMembership[]> {
    const result = await this.database.query(
      `SELECT m.id, m.trip_id, u.firebase_uid, m.display_name, m.status
         FROM trip_memberships m
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.trip_id = $1 AND m.status = 'active'
        ORDER BY m.created_at, m.id`,
      [tripId],
    );
    return result.rows.map(mapMembership);
  }

  async createExpense(expense: NewExpense): Promise<void> {
    if (expense.receiptId) {
      throw new ServiceError(400, 'Receipt uploads are not supported yet');
    }
    return this.transaction(async (database) => {
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

      await database.query(
        `INSERT INTO expenses
           (id, trip_id, paid_by_membership_id, description, total_minor, currency, split_type)
         VALUES ($1, $2, $3, $4, $5, 'INR', $6)`,
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
    });
  }

  getBalanceLedgerForMember(firebaseUid: string, tripId: string): Promise<BalanceLedger | null> {
    return this.transaction(async (database) => {
      const authorization = await database.query(
        `SELECT EXISTS (
           SELECT 1
             FROM trip_memberships m
             JOIN users u ON u.id = m.user_id
            WHERE u.firebase_uid = $1 AND m.trip_id = $2 AND m.status = 'active'
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
            WHERE e.trip_id = $1
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
