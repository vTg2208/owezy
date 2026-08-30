import { describe, expect, it } from 'vitest';
import { PostgresExpenseRepository } from './expenseRepository';

class ExpenseQueryBoundary {
  transactionOpen = false;
  expenseInsertedInTransaction = false;
  splitsInsertedInTransaction = false;
  activeMembershipsLocked = false;
  confirmedPaymentsOnly = false;
  expenseRows: Record<string, unknown>[] = [];
  paymentRows: Record<string, unknown>[] = [];

  async query(text: string) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT id FROM trip_memberships') && sql.includes('FOR UPDATE')) {
      this.activeMembershipsLocked = this.transactionOpen && sql.includes("status = 'active'");
      return { rows: [{ id: 'member-a' }, { id: 'member-b' }], rowCount: 2 };
    }
    if (sql.startsWith('INSERT INTO expenses')) {
      this.expenseInsertedInTransaction = this.transactionOpen;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO expense_splits')) {
      this.splitsInsertedInTransaction = this.transactionOpen;
      return { rows: [], rowCount: 2 };
    }
    if (sql.includes('AS authorized')) return { rows: [{ authorized: true }], rowCount: 1 };
    if (sql.includes('FROM trip_memberships m') && !sql.includes('JOIN users')) {
      return { rows: [{ id: 'member-a', trip_id: 'trip-1', display_name: 'Alice', status: 'active' }], rowCount: 1 };
    }
    if (sql.includes('FROM expenses e')) return { rows: this.expenseRows, rowCount: this.expenseRows.length };
    if (sql.includes('FROM payments p')) {
      this.confirmedPaymentsOnly = sql.includes("p.status = 'confirmed'");
      return { rows: this.paymentRows, rowCount: this.paymentRows.length };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

describe('PostgresExpenseRepository', () => {
  it('writes the expense and every split in one transaction', async () => {
    const database = new ExpenseQueryBoundary();
    const repository = new PostgresExpenseRepository(database, async (work) => {
      database.transactionOpen = true;
      try {
        return await work(database);
      } finally {
        database.transactionOpen = false;
      }
    });

    await repository.createExpense({
      id: 'expense-1', tripId: 'trip-1', paidByMembershipId: 'member-a', description: 'Meal',
      totalMinor: 1000n, splitType: 'equal', splits: [
        { membershipId: 'member-a', amountMinor: 500n },
        { membershipId: 'member-b', amountMinor: 500n },
      ],
    });

    expect(database.expenseInsertedInTransaction).toBe(true);
    expect(database.splitsInsertedInTransaction).toBe(true);
    expect(database.activeMembershipsLocked).toBe(true);
  });

  it('loads only confirmed payments for an authorized member balance', async () => {
    const database = new ExpenseQueryBoundary();
    const repository = new PostgresExpenseRepository(database, async (work) => work(database));

    const ledger = await repository.getBalanceLedgerForMember('firebase-1', 'trip-1');

    expect(ledger).toEqual({
      memberships: [{ id: 'member-a', tripId: 'trip-1', firebaseUid: null, name: 'Alice', status: 'active' }],
      expenses: [],
      payments: [],
    });
    expect(database.confirmedPaymentsOnly).toBe(true);
  });

  it('preserves PostgreSQL bigint values without converting them to number', async () => {
    const database = new ExpenseQueryBoundary();
    database.expenseRows = [{
      expense_id: 'expense-large',
      paid_by_membership_id: 'member-a',
      total_minor: '9007199254740993',
      membership_id: 'member-b',
      amount_minor: '9007199254740993',
    }];
    database.paymentRows = [{
      payer_membership_id: 'member-b',
      payee_membership_id: 'member-a',
      amount_minor: '9007199254740995',
    }];
    const repository = new PostgresExpenseRepository(database, async (work) => work(database));

    const ledger = await repository.getBalanceLedgerForMember('firebase-1', 'trip-1');

    expect(ledger?.expenses).toEqual([{
      paidByMembershipId: 'member-a',
      totalMinor: 9007199254740993n,
      splits: [{ membershipId: 'member-b', amountMinor: 9007199254740993n }],
    }]);
    expect(ledger?.payments).toEqual([{
      payerMembershipId: 'member-b',
      payeeMembershipId: 'member-a',
      amountMinor: 9007199254740995n,
      status: 'confirmed',
    }]);
  });

  it('defensively rejects unsupported receipt metadata instead of discarding it', async () => {
    const database = new ExpenseQueryBoundary();
    const repository = new PostgresExpenseRepository(database, async (work) => work(database));

    await expect(repository.createExpense({
      id: 'expense-1', tripId: 'trip-1', paidByMembershipId: 'member-a', description: 'Meal',
      totalMinor: 1000n, splitType: 'equal', receiptId: 'receipt-1', splits: [
        { membershipId: 'member-a', amountMinor: 500n },
        { membershipId: 'member-b', amountMinor: 500n },
      ],
    })).rejects.toMatchObject({ status: 400, message: 'Receipt uploads are not supported yet' });
  });
});
