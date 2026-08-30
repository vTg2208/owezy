import { describe, expect, it } from 'vitest';
import { PostgresExpenseRepository } from './expenseRepository';

class ExpenseQueryBoundary {
  transactionOpen = false;
  expenseInsertedInTransaction = false;
  splitsInsertedInTransaction = false;
  activeMembershipsLocked = false;
  confirmedPaymentsOnly = false;

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
    if (sql.includes('FROM expenses e')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM payments p')) {
      this.confirmedPaymentsOnly = sql.includes("p.status = 'confirmed'");
      return { rows: [], rowCount: 0 };
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
      totalMinor: 1000, splitType: 'equal', splits: [
        { membershipId: 'member-a', amountMinor: 500 },
        { membershipId: 'member-b', amountMinor: 500 },
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
});
