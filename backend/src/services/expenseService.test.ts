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
  it('returns controlled validation errors for non-string descriptions and malformed splits', async () => {
    const expenseService = service();

    await expect(expenseService.createExpense('user-a', 'trip-1', {
      description: 42 as unknown as string,
      amount: 10,
      splitType: 'equal',
      splits: [{ participantId: 'member-a', amount: 10 }],
    })).rejects.toMatchObject({ status: 400 });
    await expect(expenseService.createExpense('user-a', 'trip-1', {
      description: 'Meal',
      amount: 10,
      splitType: 'custom',
      splits: null as unknown as [],
    })).rejects.toMatchObject({ status: 400 });
    await expect(expenseService.createExpense('user-a', 'trip-1', {
      description: 'Meal',
      amount: 10,
      splitType: 'custom',
      splits: [{ participantId: null as unknown as string, amount: 10 }],
    })).rejects.toMatchObject({ status: 400 });
  });

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
    expect(repository.expenses[0]).toMatchObject({ paidByMembershipId: 'member-a', totalMinor: 10000n });
    expect(repository.expenses[0].splits).toEqual([
      { membershipId: 'member-a', amountMinor: 5000n },
      { membershipId: 'member-c', amountMinor: 5000n },
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
      { membershipId: 'member-a', amountMinor: 3333n },
      { membershipId: 'member-b', amountMinor: 3333n },
      { membershipId: 'member-c', amountMinor: 3334n },
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
      { membershipId: 'member-a', amountMinor: 208967022709991n },
      { membershipId: 'member-b', amountMinor: 8798232232031000n },
    ]);
  });

  it('preserves a finite two-decimal JSON number at the expense boundary', async () => {
    const repository = new MemoryExpenseRepository();

    await service(repository).createExpense('user-a', 'trip-1', {
      description: 'Lunch', amount: 12.34,
      splitType: 'equal', splits: [{ participantId: 'member-a', amount: 0 }],
    });

    expect(repository.expenses[0]).toMatchObject({ totalMinor: 1234n });
    expect(repository.expenses[0].splits).toEqual([
      { membershipId: 'member-a', amountMinor: 1234n },
    ]);
  });

  it('preserves 10.29 as exactly 1029 minor units from JSON input', async () => {
    const repository = new MemoryExpenseRepository();

    await service(repository).createExpense('user-a', 'trip-1', {
      description: 'Snack', amount: 10.29,
      splitType: 'equal', splits: [{ participantId: 'member-a', amount: 0 }],
    });

    expect(repository.expenses[0]).toMatchObject({ totalMinor: 1029n });
  });

  it('rejects an unsafe JSON number before it can be rounded into a different amount', async () => {
    const repository = new MemoryExpenseRepository();

    await expect(service(repository).createExpense('user-a', 'trip-1', {
      description: 'Rounded booking', amount: 90071992547409.93,
      splitType: 'equal', splits: [{ participantId: 'member-a', amount: 0 }],
    })).rejects.toMatchObject({
      status: 400,
      message: 'amount must be a positive amount with at most two decimal places',
    });
    expect(repository.expenses).toEqual([]);
  });

  it('rejects a rounded JSON number even when its rounded magnitude is below the bound', async () => {
    const repository = new MemoryExpenseRepository();

    await expect(service(repository).createExpense('user-a', 'trip-1', {
      description: 'Rounded booking', amount: 90071992547409.87,
      splitType: 'equal', splits: [{ participantId: 'member-a', amount: 0 }],
    })).rejects.toMatchObject({
      status: 400,
      message: 'amount must be a positive amount with at most two decimal places',
    });
    expect(repository.expenses).toEqual([]);
  });

  it('requires active membership before creating an expense', async () => {
    await expect(service().createExpense('outsider', 'trip-1', {
      description: 'Meal', amount: 10, splitType: 'equal', splits: [{ participantId: 'member-a', amount: 10 }],
    })).rejects.toMatchObject({ status: 403 });
  });

  it('forwards a validated pending receipt ID with the authenticated payer', async () => {
    const repository = new MemoryExpenseRepository();
    const expenseService = service(repository);
    const input = {
      description: 'Meal', amount: 10, splitType: 'equal' as const,
      splits: [{ participantId: 'member-a', amount: 10 }],
    };

    await expenseService.createExpense('user-a', 'trip-1', { ...input, receiptId: 'receipt-1' });

    expect(repository.expenses[0]).toMatchObject({
      paidByMembershipId: 'member-a',
      receiptId: 'receipt-1',
    });
  });

  it('rejects malformed receipt IDs and legacy receipt URLs', async () => {
    const expenseService = service();
    const input = {
      description: 'Meal', amount: 10, splitType: 'equal' as const,
      splits: [{ participantId: 'member-a', amount: 10 }],
    };

    await expect(expenseService.createExpense('user-a', 'trip-1', {
      ...input, receiptId: '../foreign-receipt',
    })).rejects.toMatchObject({ status: 400, message: 'receiptId is invalid' });
    await expect(expenseService.createExpense('user-a', 'trip-1', {
      ...input, receiptUrl: 'data:image/png;base64,bytes',
    })).rejects.toMatchObject({
      status: 400,
      message: 'receiptUrl is not accepted; upload the receipt first and send receiptId',
    });
    await expect(expenseService.createExpense('user-a', 'trip-1', {
      ...input, receiptId: { malformed: true } as unknown as string,
    })).rejects.toMatchObject({ status: 400, message: 'receiptId is invalid' });
  });
});

describe('calculateBalanceReport', () => {
  it('includes confirmed payments, stays zero-sum in minor units, and derives settlements', () => {
    const expense: LedgerExpense = {
      paidByMembershipId: 'member-a',
      totalMinor: 10000n,
      splits: [
        { membershipId: 'member-a', amountMinor: 3334n },
        { membershipId: 'member-b', amountMinor: 3333n },
        { membershipId: 'member-c', amountMinor: 3333n },
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
        { payerMembershipId: 'member-b', payeeMembershipId: 'member-a', amountMinor: 1000n, status: 'confirmed' },
        { payerMembershipId: 'member-c', payeeMembershipId: 'member-a', amountMinor: 500n, status: 'pending' },
      ],
    });

    expect(report.balanceMinorByMember).toEqual({
      'member-a': 5666n,
      'member-b': -2333n,
      'member-c': -3333n,
    });
    expect(Object.values(report.balanceMinorByMember).reduce((sum, value) => sum + value, 0n)).toBe(0n);
    expect(report.settlementMinor).toEqual([
      { from: 'member-c', to: 'member-a', amountMinor: 3333n, fromName: 'Cara', toName: 'Alice' },
      { from: 'member-b', to: 'member-a', amountMinor: 2333n, fromName: 'Bob', toName: 'Alice' },
    ]);
  });

  it('keeps aggregate balances and settlements exact above Number.MAX_SAFE_INTEGER', () => {
    const report = calculateBalanceReport({
      memberships: [
        { id: 'member-a', tripId: 'trip-1', firebaseUid: 'user-a', name: 'Alice', status: 'active' },
        { id: 'member-b', tripId: 'trip-1', firebaseUid: 'user-b', name: 'Bob', status: 'active' },
      ],
      expenses: [
        {
          paidByMembershipId: 'member-a',
          totalMinor: 9007199254740991n,
          splits: [{ membershipId: 'member-b', amountMinor: 9007199254740991n }],
        },
        {
          paidByMembershipId: 'member-a',
          totalMinor: 9007199254740991n,
          splits: [{ membershipId: 'member-b', amountMinor: 9007199254740991n }],
        },
      ],
      payments: [
        {
          payerMembershipId: 'member-b', payeeMembershipId: 'member-a',
          amountMinor: 1n, status: 'confirmed',
        },
      ],
    });

    expect(report.balanceMinorByMember).toEqual({
      'member-a': 18014398509481981n,
      'member-b': -18014398509481981n,
    });
    expect(report.settlementMinor).toEqual([{
      from: 'member-b', to: 'member-a', amountMinor: 18014398509481981n,
      fromName: 'Bob', toName: 'Alice',
    }]);
  });

  it('fails explicitly when an exact balance cannot fit the legacy numeric HTTP contract', async () => {
    const repository = new MemoryExpenseRepository();
    repository.ledger = {
      memberships: [
        { id: 'member-a', tripId: 'trip-1', firebaseUid: 'user-a', name: 'Alice', status: 'active' },
        { id: 'member-b', tripId: 'trip-1', firebaseUid: 'user-b', name: 'Bob', status: 'active' },
      ],
      expenses: [
        {
          paidByMembershipId: 'member-a',
          totalMinor: 9007199254740991n,
          splits: [{ membershipId: 'member-b', amountMinor: 9007199254740991n }],
        },
        {
          paidByMembershipId: 'member-a',
          totalMinor: 9007199254740991n,
          splits: [{ membershipId: 'member-b', amountMinor: 9007199254740991n }],
        },
      ],
      payments: [],
    };

    await expect(service(repository).getBalances('user-a', 'trip-1')).rejects.toMatchObject({
      status: 500,
      message: 'Balance exceeds the legacy numeric HTTP range',
    });
  });
});
