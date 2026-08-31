import { allocateEqual, majorToMinor } from '../domain/money';
import { generateId } from '../utils/helpers';
import { z } from 'zod';
import { ServiceError } from './errors';
import type { QueryExecutor } from '../repositories/database';

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
  amountMinor: bigint;
}

export interface NewExpense {
  id: string;
  tripId: string;
  paidByMembershipId: string;
  description: string;
  totalMinor: bigint;
  splitType: SplitType;
  splits: ExpenseAllocation[];
  receiptId?: string;
}

export interface LedgerExpense {
  paidByMembershipId: string;
  totalMinor: bigint;
  splits: ExpenseAllocation[];
}

export interface LedgerPayment {
  payerMembershipId: string;
  payeeMembershipId: string;
  amountMinor: bigint;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
}

export interface BalanceLedger {
  memberships: LedgerMembership[];
  expenses: LedgerExpense[];
  payments: LedgerPayment[];
}

export interface ExpenseRepository {
  findActiveMembership(firebaseUid: string, tripId: string, database?: QueryExecutor): Promise<LedgerMembership | null>;
  listActiveMemberships(tripId: string, database?: QueryExecutor): Promise<LedgerMembership[]>;
  createExpense(expense: NewExpense, database?: QueryExecutor): Promise<void>;
  getBalanceLedgerForMember(firebaseUid: string, tripId: string): Promise<BalanceLedger | null>;
  correctExpenseForActor?(
    firebaseUid: string,
    tripId: string,
    expenseId: string,
    expectedVersion: number,
    replacement: ExpenseRevision,
    database?: QueryExecutor,
  ): Promise<ExpenseLifecycleResult>;
  voidExpenseForActor?(
    firebaseUid: string,
    tripId: string,
    expenseId: string,
    expectedVersion: number,
    database?: QueryExecutor,
  ): Promise<ExpenseLifecycleResult>;
}

export interface ExpenseRevision {
  id: string;
  description: string;
  totalMinor: bigint;
  splitType: SplitType;
  splits: ExpenseAllocation[];
  receiptId?: string;
}

export type ExpenseLifecycleResult =
  | { kind: 'updated'; expenseId: string; expenseKey: string; version: number; status: 'active' | 'voided' }
  | { kind: 'forbidden' | 'not-found' | 'conflict' };

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
  amountMinor: bigint;
  fromName: string;
  toName: string;
}

export interface BalanceReport {
  balanceMinorByMember: Record<string, bigint>;
  settlementMinor: MinorSettlement[];
}

const expenseInputSchema = z.object({
  paidBy: z.unknown().optional(),
  description: z.string().max(500),
  amount: z.union([z.string(), z.number()]),
  splitType: z.enum(['equal', 'custom', 'percentage']).optional(),
  splits: z.array(z.object({
    participantId: z.string().min(1),
    amount: z.union([z.string(), z.number()]),
  })).max(200).optional(),
  receiptId: z.unknown().optional(),
  receiptUrl: z.unknown().optional(),
}).passthrough();

function parseMajor(value: string | number, field: string): bigint {
  try {
    if (typeof value === 'number') {
      const text = String(value);
      const scaled = value * 100;
      const rounded = Math.round(scaled);
      const floatingError = Number.EPSILON * Math.max(1, Math.abs(scaled));
      if (
        !Number.isFinite(value)
        || value > Math.floor(Number.MAX_SAFE_INTEGER / 100)
        || !/^\d+(?:\.\d{1,2})?$/.test(text)
        || !Number.isSafeInteger(rounded)
        || Math.abs(scaled - rounded) > floatingError
        || rounded <= 0
      ) {
        throw new Error('unsafe number');
      }
      return BigInt(rounded);
    }
    return majorToMinor(value);
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

function containsReceiptMetadata(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value === 'string' ? value.trim().length > 0 : true;
}

function parseReceiptId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new ServiceError(400, 'receiptId is invalid');
  }
  return value;
}

function allocatePercentages(
  totalMinor: bigint,
  splits: Array<{ membershipId: string; basisPoints: number; index: number }>,
): ExpenseAllocation[] {
  const provisional = splits.map((split) => {
    const product = totalMinor * BigInt(split.basisPoints);
    return {
      membershipId: split.membershipId,
      amountMinor: product / 10000n,
      remainder: product % 10000n,
      index: split.index,
    };
  });
  const remaining = totalMinor - provisional.reduce((sum, split) => sum + split.amountMinor, 0n);
  const remainderOrder = [...provisional].sort(
    (left, right) => left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder ? -1 : 1,
  );
  for (let index = 0; index < Number(remaining); index += 1) {
    remainderOrder[index].amountMinor += 1n;
  }
  return provisional.map(({ membershipId, amountMinor }) => ({ membershipId, amountMinor }));
}

async function prepareExpense(
  repository: ExpenseRepository,
  tripId: string,
  input: ExpenseInput,
  database?: QueryExecutor,
): Promise<Omit<ExpenseRevision, 'id'>> {
  const parsed = expenseInputSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError(400, 'Invalid expense payload');
  const validatedInput = parsed.data;

  if (containsReceiptMetadata(validatedInput.receiptUrl)) {
    throw new ServiceError(400, 'receiptUrl is not accepted; upload the receipt first and send receiptId');
  }
  const receiptId = parseReceiptId(validatedInput.receiptId);
  const description = validatedInput.description.trim();
  if (!description) throw new ServiceError(400, 'description and amount are required');
  const totalMinor = parseMajor(validatedInput.amount, 'amount');
  const splitType = validatedInput.splitType ?? 'equal';

  const activeMemberships = await repository.listActiveMemberships(tripId, database);
  const activeIds = new Set(activeMemberships.map((membership) => membership.id));
  const requestedSplits = validatedInput.splits;
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
    if (allocations.reduce((sum, split) => sum + split.amountMinor, 0n) !== totalMinor) {
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
    if (allocations.some((allocation) => allocation.amountMinor <= 0n)) {
      throw new ServiceError(400, 'Every split member must receive a positive amount');
    }
  }

  return {
    description,
    totalMinor,
    splitType,
    splits: allocations,
    ...(receiptId ? { receiptId } : {}),
  };
}

function lifecycleError(result: Exclude<ExpenseLifecycleResult, { kind: 'updated' }>): never {
  if (result.kind === 'not-found') throw new ServiceError(404, 'Expense not found');
  if (result.kind === 'conflict') throw new ServiceError(409, 'Expense version is stale or no longer active');
  throw new ServiceError(403, 'Only the payer or trip owner can change this expense');
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
    database?: QueryExecutor,
  ): Promise<{ expenseId: string; splitType: SplitType; memberCount: number }> {
    const actor = await this.repository.findActiveMembership(firebaseUid, tripId, database);
    if (!actor) throw new ServiceError(403, 'You are not a member of this trip');
    const prepared = await prepareExpense(this.repository, tripId, input, database);
    const expenseId = this.createId();
    await this.repository.createExpense({
      id: expenseId,
      tripId,
      paidByMembershipId: actor.id,
      ...prepared,
    }, database);
    return { expenseId, splitType: prepared.splitType, memberCount: prepared.splits.length };
  }

  async correctExpense(
    firebaseUid: string,
    tripId: string,
    expenseId: string,
    expectedVersion: number,
    input: ExpenseInput,
    database?: QueryExecutor,
  ) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new ServiceError(400, 'expectedVersion must be a positive integer');
    }
    if (!this.repository.correctExpenseForActor) {
      throw new ServiceError(503, 'Expense corrections are unavailable');
    }
    const replacement: ExpenseRevision = {
      id: this.createId(),
      ...await prepareExpense(this.repository, tripId, input, database),
    };
    const result = await this.repository.correctExpenseForActor(
      firebaseUid, tripId, expenseId, expectedVersion, replacement, database,
    );
    if (result.kind !== 'updated') lifecycleError(result);
    return result;
  }

  async voidExpense(
    firebaseUid: string,
    tripId: string,
    expenseId: string,
    expectedVersion: number,
    database?: QueryExecutor,
  ) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new ServiceError(400, 'expectedVersion must be a positive integer');
    }
    if (!this.repository.voidExpenseForActor) {
      throw new ServiceError(503, 'Expense voiding is unavailable');
    }
    const result = await this.repository.voidExpenseForActor(
      firebaseUid, tripId, expenseId, expectedVersion, database,
    );
    if (result.kind !== 'updated') lifecycleError(result);
    return result;
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
        balance: minorToLegacyNumber(amountMinor),
      })),
      settlements: report.settlementMinor.map((settlement) => ({
        from: settlement.from,
        to: settlement.to,
        amount: minorToLegacyNumber(settlement.amountMinor),
        fromName: settlement.fromName,
        toName: settlement.toName,
      })),
    };
  }
}

export function calculateBalanceReport(ledger: BalanceLedger): BalanceReport {
  const balances = new Map(ledger.memberships.map((membership) => [membership.id, 0n]));
  for (const expense of ledger.expenses) {
    balances.set(
      expense.paidByMembershipId,
      (balances.get(expense.paidByMembershipId) ?? 0n) + expense.totalMinor,
    );
    for (const split of expense.splits) {
      balances.set(split.membershipId, (balances.get(split.membershipId) ?? 0n) - split.amountMinor);
    }
  }
  for (const payment of ledger.payments) {
    if (payment.status !== 'confirmed') continue;
    balances.set(
      payment.payerMembershipId,
      (balances.get(payment.payerMembershipId) ?? 0n) + payment.amountMinor,
    );
    balances.set(
      payment.payeeMembershipId,
      (balances.get(payment.payeeMembershipId) ?? 0n) - payment.amountMinor,
    );
  }

  const total = [...balances.values()].reduce((sum, value) => sum + value, 0n);
  if (total !== 0n) throw new Error(`Trip ledger is not zero-sum (${total} minor units)`);

  const names = new Map(ledger.memberships.map((membership) => [membership.id, membership.name]));
  const creditors = [...balances.entries()]
    .filter(([, balance]) => balance > 0n)
    .map(([id, balance]) => ({ id, balance }))
    .sort((left, right) => left.balance === right.balance
      ? left.id.localeCompare(right.id)
      : left.balance > right.balance ? -1 : 1);
  const debtors = [...balances.entries()]
    .filter(([, balance]) => balance < 0n)
    .map(([id, balance]) => ({ id, balance }))
    .sort((left, right) => left.balance === right.balance
      ? left.id.localeCompare(right.id)
      : left.balance < right.balance ? -1 : 1);
  const settlements: MinorSettlement[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amountMinor = creditor.balance < -debtor.balance ? creditor.balance : -debtor.balance;
    settlements.push({
      from: debtor.id,
      to: creditor.id,
      amountMinor,
      fromName: names.get(debtor.id) ?? 'Unknown',
      toName: names.get(creditor.id) ?? 'Unknown',
    });
    creditor.balance -= amountMinor;
    debtor.balance += amountMinor;
    if (creditor.balance === 0n) creditorIndex += 1;
    if (debtor.balance === 0n) debtorIndex += 1;
  }

  return {
    balanceMinorByMember: Object.fromEntries(balances),
    settlementMinor: settlements,
  };
}

const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

export function minorToLegacyNumber(amountMinor: bigint, label = 'Balance'): number {
  if (amountMinor > MAX_SAFE_MINOR || amountMinor < -MAX_SAFE_MINOR) {
    throw new ServiceError(500, `${label} exceeds the legacy numeric HTTP range`);
  }
  return Number(amountMinor) / 100;
}
