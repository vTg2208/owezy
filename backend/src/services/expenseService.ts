import { allocateEqual, majorToMinor } from '../domain/money';
import { generateId } from '../utils/helpers';
import { ServiceError } from './errors';

export type SplitType = 'equal' | 'custom' | 'percentage';

export interface LedgerMembership {
  id: string;
  tripId: string;
  firebaseUid: string | null;
  name: string;
  status: 'active' | 'left' | 'anonymized';
}

export interface ExpenseAllocation {
  membershipId: string;
  amountMinor: number;
}

export interface NewExpense {
  id: string;
  tripId: string;
  paidByMembershipId: string;
  description: string;
  totalMinor: number;
  splitType: SplitType;
  splits: ExpenseAllocation[];
  receiptId?: string;
}

export interface LedgerExpense {
  paidByMembershipId: string;
  totalMinor: number;
  splits: ExpenseAllocation[];
}

export interface LedgerPayment {
  payerMembershipId: string;
  payeeMembershipId: string;
  amountMinor: number;
  status: 'pending' | 'confirmed' | 'cancelled';
}

export interface BalanceLedger {
  memberships: LedgerMembership[];
  expenses: LedgerExpense[];
  payments: LedgerPayment[];
}

export interface ExpenseRepository {
  findActiveMembership(firebaseUid: string, tripId: string): Promise<LedgerMembership | null>;
  listActiveMemberships(tripId: string): Promise<LedgerMembership[]>;
  createExpense(expense: NewExpense): Promise<void>;
  getBalanceLedgerForMember(firebaseUid: string, tripId: string): Promise<BalanceLedger | null>;
}

export interface ExpenseSplitInput {
  participantId: string;
  amount: string | number;
}

export interface ExpenseInput {
  paidBy?: string;
  description: string;
  amount: string | number;
  splitType?: SplitType;
  splits?: ExpenseSplitInput[];
  receiptId?: string;
  receiptUrl?: string;
}

export interface MinorSettlement {
  from: string;
  to: string;
  amountMinor: number;
  fromName: string;
  toName: string;
}

export interface BalanceReport {
  balanceMinorByMember: Record<string, number>;
  settlementMinor: MinorSettlement[];
}

function parseMajor(value: string | number, field: string): number {
  try {
    return majorToMinor(String(value));
  } catch {
    throw new ServiceError(400, `${field} must be a positive amount with at most two decimal places`);
  }
}

function percentageToBasisPoints(value: string | number): number {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new ServiceError(400, 'Percentages must have at most two decimal places');
  }
  const [whole, fraction = ''] = text.split('.');
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(basisPoints) || basisPoints <= 0 || basisPoints > 10000) {
    throw new ServiceError(400, 'Percentages must be greater than zero and at most 100');
  }
  return basisPoints;
}

function allocatePercentages(
  totalMinor: number,
  splits: Array<{ membershipId: string; basisPoints: number; index: number }>,
): ExpenseAllocation[] {
  const provisional = splits.map((split) => {
    const product = BigInt(totalMinor) * BigInt(split.basisPoints);
    return {
      membershipId: split.membershipId,
      amountMinor: Number(product / 10000n),
      remainder: Number(product % 10000n),
      index: split.index,
    };
  });
  let remaining = totalMinor - provisional.reduce((sum, split) => sum + split.amountMinor, 0);
  const remainderOrder = [...provisional].sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index,
  );
  for (let index = 0; index < remaining; index += 1) {
    remainderOrder[index].amountMinor += 1;
  }
  return provisional.map(({ membershipId, amountMinor }) => ({ membershipId, amountMinor }));
}

export class ExpenseService {
  constructor(
    private readonly repository: ExpenseRepository,
    private readonly createId: () => string = generateId,
  ) {}

  async createExpense(
    firebaseUid: string,
    tripId: string,
    input: ExpenseInput,
  ): Promise<{ expenseId: string; splitType: SplitType; memberCount: number }> {
    const actor = await this.repository.findActiveMembership(firebaseUid, tripId);
    if (!actor) throw new ServiceError(403, 'You are not a member of this trip');

    const description = input.description?.trim();
    if (!description) throw new ServiceError(400, 'description and amount are required');
    const totalMinor = parseMajor(input.amount, 'amount');
    const splitType = input.splitType ?? 'equal';
    if (!['equal', 'custom', 'percentage'].includes(splitType)) {
      throw new ServiceError(400, 'Invalid split type');
    }

    const activeMemberships = await this.repository.listActiveMemberships(tripId);
    const activeIds = new Set(activeMemberships.map((membership) => membership.id));
    const requestedSplits = input.splits;
    if (requestedSplits && requestedSplits.length === 0) {
      throw new ServiceError(400, 'At least one split member is required');
    }

    const splitInputs = requestedSplits ?? activeMemberships.map((membership) => ({
      participantId: membership.id,
      amount: 0,
    }));
    const membershipIds = splitInputs.map((split) => split.participantId);
    if (new Set(membershipIds).size !== membershipIds.length) {
      throw new ServiceError(400, 'Split members must not contain duplicates');
    }
    if (membershipIds.some((membershipId) => !activeIds.has(membershipId))) {
      throw new ServiceError(400, 'Every split member must be an active member of this trip');
    }

    let allocations: ExpenseAllocation[];
    if (splitType === 'equal') {
      try {
        allocations = allocateEqual(totalMinor, membershipIds).map((allocation) => ({
          membershipId: allocation.memberId,
          amountMinor: allocation.amountMinor,
        }));
      } catch (error) {
        throw new ServiceError(400, error instanceof Error ? error.message : 'Invalid equal split');
      }
    } else if (splitType === 'custom') {
      allocations = splitInputs.map((split) => ({
        membershipId: split.participantId,
        amountMinor: parseMajor(split.amount, 'Split amount'),
      }));
      if (allocations.reduce((sum, split) => sum + split.amountMinor, 0) !== totalMinor) {
        throw new ServiceError(400, 'Custom splits must equal the expense total');
      }
    } else {
      const percentageSplits = splitInputs.map((split, index) => ({
        membershipId: split.participantId,
        basisPoints: percentageToBasisPoints(split.amount),
        index,
      }));
      if (percentageSplits.reduce((sum, split) => sum + split.basisPoints, 0) !== 10000) {
        throw new ServiceError(400, 'Percentages must add up to 100');
      }
      allocations = allocatePercentages(totalMinor, percentageSplits);
      if (allocations.some((allocation) => allocation.amountMinor <= 0)) {
        throw new ServiceError(400, 'Every split member must receive a positive amount');
      }
    }

    const expenseId = this.createId();
    await this.repository.createExpense({
      id: expenseId,
      tripId,
      paidByMembershipId: actor.id,
      description,
      totalMinor,
      splitType,
      splits: allocations,
      receiptId: input.receiptId,
    });
    return { expenseId, splitType, memberCount: allocations.length };
  }

  async getBalances(firebaseUid: string, tripId: string): Promise<{
    balances: Array<{ memberId: string; memberName: string; balance: number }>;
    settlements: Array<{ from: string; to: string; amount: number; fromName: string; toName: string }>;
  }> {
    const ledger = await this.repository.getBalanceLedgerForMember(firebaseUid, tripId);
    if (!ledger) throw new ServiceError(403, 'You are not a member of this trip');
    const report = calculateBalanceReport(ledger);
    const names = new Map(ledger.memberships.map((membership) => [membership.id, membership.name]));
    return {
      balances: Object.entries(report.balanceMinorByMember).map(([memberId, amountMinor]) => ({
        memberId,
        memberName: names.get(memberId) ?? 'Unknown',
        balance: amountMinor / 100,
      })),
      settlements: report.settlementMinor.map((settlement) => ({
        from: settlement.from,
        to: settlement.to,
        amount: settlement.amountMinor / 100,
        fromName: settlement.fromName,
        toName: settlement.toName,
      })),
    };
  }
}

export function calculateBalanceReport(ledger: BalanceLedger): BalanceReport {
  const balances = new Map(ledger.memberships.map((membership) => [membership.id, 0]));
  for (const expense of ledger.expenses) {
    balances.set(
      expense.paidByMembershipId,
      (balances.get(expense.paidByMembershipId) ?? 0) + expense.totalMinor,
    );
    for (const split of expense.splits) {
      balances.set(split.membershipId, (balances.get(split.membershipId) ?? 0) - split.amountMinor);
    }
  }
  for (const payment of ledger.payments) {
    if (payment.status !== 'confirmed') continue;
    balances.set(
      payment.payerMembershipId,
      (balances.get(payment.payerMembershipId) ?? 0) + payment.amountMinor,
    );
    balances.set(
      payment.payeeMembershipId,
      (balances.get(payment.payeeMembershipId) ?? 0) - payment.amountMinor,
    );
  }

  const total = [...balances.values()].reduce((sum, value) => sum + value, 0);
  if (total !== 0) throw new Error(`Trip ledger is not zero-sum (${total} minor units)`);

  const names = new Map(ledger.memberships.map((membership) => [membership.id, membership.name]));
  const creditors = [...balances.entries()]
    .filter(([, balance]) => balance > 0)
    .map(([id, balance]) => ({ id, balance }))
    .sort((left, right) => right.balance - left.balance || left.id.localeCompare(right.id));
  const debtors = [...balances.entries()]
    .filter(([, balance]) => balance < 0)
    .map(([id, balance]) => ({ id, balance }))
    .sort((left, right) => left.balance - right.balance || left.id.localeCompare(right.id));
  const settlements: MinorSettlement[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amountMinor = Math.min(creditor.balance, -debtor.balance);
    settlements.push({
      from: debtor.id,
      to: creditor.id,
      amountMinor,
      fromName: names.get(debtor.id) ?? 'Unknown',
      toName: names.get(creditor.id) ?? 'Unknown',
    });
    creditor.balance -= amountMinor;
    debtor.balance += amountMinor;
    if (creditor.balance === 0) creditorIndex += 1;
    if (debtor.balance === 0) debtorIndex += 1;
  }

  return {
    balanceMinorByMember: Object.fromEntries(balances),
    settlementMinor: settlements,
  };
}
