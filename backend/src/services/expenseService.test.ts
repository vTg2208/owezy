import { describe, expect, it } from 'vitest';
import {
  BalanceLedger,
  ExpenseRepository,
  ExpenseService,
  LedgerExpense,
  LedgerMembership,
  NewExpense,
  calculateBalanceReport,
} from './expenseService';

class MemoryExpenseRepository implements ExpenseRepository {
  readonly memberships: LedgerMembership[] = [
    { id: 'member-a', tripId: 'trip-1', firebaseUid: 'user-a', name: 'Alice', status: 'active' },
    { id: 'member-b', tripId: 'trip-1', firebaseUid: 'user-b', name: 'Bob', status: 'active' },
    { id: 'member-c', tripId: 'trip-1', firebaseUid: 'user-c', name: 'Cara', status: 'active' },
    { id: 'member-left', tripId: 'trip-1', firebaseUid: 'user-left', name: 'Left', status: 'left' },
  ];
  readonly expenses: NewExpense[] = [];
  ledger: BalanceLedger = { memberships: [], expenses: [], payments: [] };

  async findActiveMembership(firebaseUid: string, tripId: string): Promise<LedgerMembership | null> {
    return this.memberships.find(
      (membership) => membership.firebaseUid === firebaseUid
        && membership.tripId === tripId
        && membership.status === 'active',
    ) ?? null;
  }

  async listActiveMemberships(tripId: string): Promise<LedgerMembership[]> {
    return this.memberships.filter((membership) => membership.tripId === tripId && membership.status === 'active');
  }

  async createExpense(expense: NewExpense): Promise<void> {
    this.expenses.push(expense);
  }

  async getBalanceLedgerForMember(firebaseUid: string, tripId: string): Promise<BalanceLedger | null> {
    return await this.findActiveMembership(firebaseUid, tripId) ? this.ledger : null;
  }
}

function service(repository = new MemoryExpenseRepository()): ExpenseService {
  return new ExpenseService(repository, () => 'expense-1');
}

describe('ExpenseService', () => {
  it('derives the payer from the authenticated membership and splits only selected equal members', async () => {
    const repository = new MemoryExpenseRepository();
    const result = await service(repository).createExpense('user-a', 'trip-1', {
      paidBy: 'member-b',
      description: 'Hotel',
      amount: 100,
      splitType: 'equal',
      splits: [
        { participantId: 'member-a', amount: 50 },
        { participantId: 'member-c', amount: 50 },
      ],
    });

    expect(result).toEqual({ expenseId: 'expense-1', splitType: 'equal', memberCount: 2 });
    expect(repository.expenses[0]).toMatchObject({ paidByMembershipId: 'member-a', totalMinor: 10000 });
    expect(repository.expenses[0].splits).toEqual([
      { membershipId: 'member-a', amountMinor: 5000 },
      { membershipId: 'member-c', amountMinor: 5000 },
    ]);
  });

  it('rejects unsupported split methods, duplicate members, and inactive or foreign members', async () => {
    const expenseService = service();
    const base = { description: 'Meal', amount: 10 };

    await expect(expenseService.createExpense('user-a', 'trip-1', {
      ...base, splitType: 'unsupported' as 'equal', splits: [{ participantId: 'member-a', amount: 10 }],
    })).rejects.toMatchObject({ status: 400 });
    await expect(expenseService.createExpense('user-a', 'trip-1', {
      ...base, splitType: 'equal', splits: [
        { participantId: 'member-a', amount: 5 }, { participantId: 'member-a', amount: 5 },
      ],
    })).rejects.toMatchObject({ status: 400 });
    await expect(expenseService.createExpense('user-a', 'trip-1', {
      ...base, splitType: 'equal', splits: [{ participantId: 'member-left', amount: 10 }],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('requires custom amounts to be positive exact minor units summing to the total', async () => {
    const expenseService = service();

    await expect(expenseService.createExpense('user-a', 'trip-1', {
      description: 'Taxi', amount: 10, splitType: 'custom', splits: [
        { participantId: 'member-a', amount: 3.33 },
        { participantId: 'member-b', amount: 6.66 },
      ],
    })).rejects.toMatchObject({ status: 400 });

    await expect(expenseService.createExpense('user-a', 'trip-1', {
      description: 'Taxi', amount: 10, splitType: 'custom', splits: [
        { participantId: 'member-a', amount: 3.333 },
        { participantId: 'member-b', amount: 6.667 },
      ],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('requires percentage splits to total 100 percent and allocates every minor unit', async () => {
    const repository = new MemoryExpenseRepository();
    const expenseService = service(repository);

    await expect(expenseService.createExpense('user-a', 'trip-1', {
      description: 'Fuel', amount: 100, splitType: 'percentage', splits: [
        { participantId: 'member-a', amount: 40 },
        { participantId: 'member-b', amount: 59.99 },
      ],
    })).rejects.toMatchObject({ status: 400 });

    await expenseService.createExpense('user-a', 'trip-1', {
      description: 'Fuel', amount: 100, splitType: 'percentage', splits: [
        { participantId: 'member-a', amount: 33.33 },
        { participantId: 'member-b', amount: 33.33 },
        { participantId: 'member-c', amount: 33.34 },
      ],
    });
    expect(repository.expenses[0].splits).toEqual([
      { membershipId: 'member-a', amountMinor: 3333 },
      { membershipId: 'member-b', amountMinor: 3333 },
      { membershipId: 'member-c', amountMinor: 3334 },
    ]);
  });

  it('allocates percentage splits exactly near the safe-integer limit', async () => {
    const repository = new MemoryExpenseRepository();

    await service(repository).createExpense('user-a', 'trip-1', {
      description: 'Large booking', amount: '90071992547409.91', splitType: 'percentage', splits: [
        { participantId: 'member-a', amount: 2.32 },
        { participantId: 'member-b', amount: 97.68 },
      ],
    });

    expect(repository.expenses[0].splits).toEqual([
      { membershipId: 'member-a', amountMinor: 208967022709991 },
      { membershipId: 'member-b', amountMinor: 8798232232031000 },
    ]);
  });

  it('requires active membership before creating an expense', async () => {
    await expect(service().createExpense('outsider', 'trip-1', {
      description: 'Meal', amount: 10, splitType: 'equal', splits: [{ participantId: 'member-a', amount: 10 }],
    })).rejects.toMatchObject({ status: 403 });
  });
});

describe('calculateBalanceReport', () => {
  it('includes confirmed payments, stays zero-sum in minor units, and derives settlements', () => {
    const expense: LedgerExpense = {
      paidByMembershipId: 'member-a',
      totalMinor: 10000,
      splits: [
        { membershipId: 'member-a', amountMinor: 3334 },
        { membershipId: 'member-b', amountMinor: 3333 },
        { membershipId: 'member-c', amountMinor: 3333 },
      ],
    };
    const report = calculateBalanceReport({
      memberships: [
        { id: 'member-a', tripId: 'trip-1', firebaseUid: 'user-a', name: 'Alice', status: 'active' },
        { id: 'member-b', tripId: 'trip-1', firebaseUid: 'user-b', name: 'Bob', status: 'active' },
        { id: 'member-c', tripId: 'trip-1', firebaseUid: 'user-c', name: 'Cara', status: 'active' },
      ],
      expenses: [expense],
      payments: [
        { payerMembershipId: 'member-b', payeeMembershipId: 'member-a', amountMinor: 1000, status: 'confirmed' },
        { payerMembershipId: 'member-c', payeeMembershipId: 'member-a', amountMinor: 500, status: 'pending' },
      ],
    });

    expect(report.balanceMinorByMember).toEqual({
      'member-a': 5666,
      'member-b': -2333,
      'member-c': -3333,
    });
    expect(Object.values(report.balanceMinorByMember).reduce((sum, value) => sum + value, 0)).toBe(0);
    expect(report.settlementMinor).toEqual([
      { from: 'member-c', to: 'member-a', amountMinor: 3333, fromName: 'Cara', toName: 'Alice' },
      { from: 'member-b', to: 'member-a', amountMinor: 2333, fromName: 'Bob', toName: 'Alice' },
    ]);
  });
});
