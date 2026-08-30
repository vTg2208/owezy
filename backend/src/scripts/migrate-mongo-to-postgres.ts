import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { majorToMinor } from '../domain/money';
import {
  DisabledReceiptStorage,
  getReceiptStorageConfig,
  LocalReceiptStorage,
  ReceiptStorage,
  SupportedReceiptContentType,
} from '../storage/receiptStorage';
import {
  defaultDatabase,
  defaultTransaction,
  QueryExecutor,
  TransactionRunner,
} from '../repositories/database';
import { shutdownDatabase } from '../database';

export interface LegacyDocument {
  _id?: unknown;
  [key: string]: unknown;
}

export interface LegacySnapshot {
  users: LegacyDocument[];
  trips: LegacyDocument[];
  members: LegacyDocument[];
  expenses: LegacyDocument[];
  messages: LegacyDocument[];
}

export interface MigrationIssue {
  code: string;
  entity: string;
  legacyId: string;
  message: string;
}

export interface LegacyMapping {
  entityType: string;
  legacyId: string;
  postgresId: string;
}

export interface MigratedUser {
  id: string;
  legacyId: string;
  firebaseUid: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface MigratedTrip {
  id: string;
  name: string;
  roomCode: string;
  ownerMembershipId: string;
  isLocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MigratedMembership {
  id: string;
  tripId: string;
  userId: string | null;
  displayName: string;
  role: 'owner' | 'member';
  createdAt: Date;
}

export interface MigratedExpense {
  id: string;
  tripId: string;
  paidByMembershipId: string;
  description: string;
  totalMinor: bigint;
  splitType: 'equal' | 'custom' | 'percentage';
  createdAt: Date;
}

export interface MigratedExpenseSplit {
  expenseId: string;
  tripId: string;
  membershipId: string;
  amountMinor: bigint;
}

export interface MigratedReceipt {
  id: string;
  legacyId: string;
  expenseId: string;
  tripId: string;
  uploadedByMembershipId: string;
  contentType: SupportedReceiptContentType;
  byteSize: number;
  checksumSha256: string;
  bytes: Buffer;
  createdAt: Date;
}

export interface MigratedMessage {
  id: string;
  tripId: string;
  membershipId: string;
  message: string;
  createdAt: Date;
}

export interface MigrationCounts {
  users: number;
  trips: number;
  memberships: number;
  expenses: number;
  expenseSplits: number;
  receipts: number;
  messages: number;
}

export interface MigrationPlan {
  users: MigratedUser[];
  trips: MigratedTrip[];
  memberships: MigratedMembership[];
  expenses: MigratedExpense[];
  expenseSplits: MigratedExpenseSplit[];
  receipts: MigratedReceipt[];
  messages: MigratedMessage[];
  mappings: LegacyMapping[];
  sourceCounts: MigrationCounts;
  rejectedCounts: MigrationCounts;
  issues: MigrationIssue[];
}

function legacyId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function validDate(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function deterministicUuid(namespace: string, value: string): string {
  const bytes = createHash('sha256').update(`${namespace}:${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicReceiptId(expenseId: string): string {
  const digest = createHash('sha256')
    .update(`owezy-legacy-receipt:${expenseId}`)
    .digest('hex')
    .slice(0, 24);
  return `receipt-${digest}`;
}

function exactMinor(value: unknown): bigint | null {
  try {
    return BigInt(majorToMinor(String(value)));
  } catch {
    return null;
  }
}

function isSupportedImage(bytes: Buffer, contentType: SupportedReceiptContentType): boolean {
  if (contentType === 'image/png') {
    return bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

function extractDataUrl(value: unknown): {
  contentType: SupportedReceiptContentType;
  bytes: Buffer;
} | null {
  if (typeof value !== 'string') return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], 'base64');
  const normalizedInput = match[2].replace(/=+$/, '');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== normalizedInput) return null;
  const contentType = match[1] as SupportedReceiptContentType;
  return isSupportedImage(bytes, contentType) ? { contentType, bytes } : null;
}

function deduplicate(
  documents: LegacyDocument[],
  entity: string,
  issues: MigrationIssue[],
  onReject: (document: LegacyDocument) => void,
): Array<{ id: string; document: LegacyDocument }> {
  const seen = new Set<string>();
  const unique: Array<{ id: string; document: LegacyDocument }> = [];
  for (const document of documents) {
    const id = legacyId(document._id);
    if (!id) {
      issues.push({
        code: 'invalid_legacy_id', entity, legacyId: '<missing>', message: `${entity} has no legacy ID`,
      });
      onReject(document);
      continue;
    }
    if (seen.has(id)) {
      issues.push({
        code: 'duplicate_legacy_id', entity, legacyId: id, message: `Duplicate ${entity} legacy ID`,
      });
      onReject(document);
      continue;
    }
    seen.add(id);
    unique.push({ id, document });
  }
  return unique;
}

function transformedCounts(plan: MigrationPlan): MigrationCounts {
  return {
    users: plan.users.length,
    trips: plan.trips.length,
    memberships: plan.memberships.length,
    expenses: plan.expenses.length,
    expenseSplits: plan.expenseSplits.length,
    receipts: plan.receipts.length,
    messages: plan.messages.length,
  };
}

export function transformLegacySnapshot(snapshot: LegacySnapshot): MigrationPlan {
  const issues: MigrationIssue[] = [];
  const users: MigratedUser[] = [];
  const trips: MigratedTrip[] = [];
  const memberships: MigratedMembership[] = [];
  const expenses: MigratedExpense[] = [];
  const expenseSplits: MigratedExpenseSplit[] = [];
  const receipts: MigratedReceipt[] = [];
  const messages: MigratedMessage[] = [];
  const mappings: LegacyMapping[] = [];
  const rejectedCounts: MigrationCounts = {
    users: 0,
    trips: 0,
    memberships: 0,
    expenses: 0,
    expenseSplits: 0,
    receipts: 0,
    messages: 0,
  };
  const hasReceipt = (document: LegacyDocument) => (
    document.receipt_url !== undefined && document.receipt_url !== null && document.receipt_url !== ''
  );
  const rejectExpense = (document: LegacyDocument) => {
    rejectedCounts.expenses += 1;
    rejectedCounts.expenseSplits += Array.isArray(document.splits) ? document.splits.length : 0;
    if (hasReceipt(document)) rejectedCounts.receipts += 1;
  };

  const uniqueUsers = deduplicate(snapshot.users, 'user', issues, () => { rejectedCounts.users += 1; });
  const uniqueTrips = deduplicate(snapshot.trips, 'trip', issues, () => { rejectedCounts.trips += 1; });
  const uniqueMembers = deduplicate(snapshot.members, 'membership', issues, () => {
    rejectedCounts.memberships += 1;
  });
  const uniqueExpenses = deduplicate(snapshot.expenses, 'expense', issues, rejectExpense);
  const uniqueMessages = deduplicate(snapshot.messages, 'message', issues, () => {
    rejectedCounts.messages += 1;
  });
  const rawMembers = new Map(uniqueMembers.map(({ id, document }) => [id, document]));
  const normalizedEmails = new Set<string>();
  const normalizedRoomCodes = new Set<string>();
  const tripUserMemberships = new Set<string>();
  const activeMemberNames = new Set<string>();

  for (const { id, document } of uniqueUsers) {
    const email = typeof document.email === 'string' ? document.email.trim().toLowerCase() : '';
    const name = typeof document.name === 'string' ? document.name.trim() : '';
    const createdAt = validDate(document.created_at);
    if (!email || !name || !createdAt) {
      issues.push({ code: 'invalid_user', entity: 'user', legacyId: id, message: 'User fields are invalid' });
      rejectedCounts.users += 1;
      continue;
    }
    if (normalizedEmails.has(email)) {
      issues.push({
        code: 'duplicate_normalized_email', entity: 'user', legacyId: id,
        message: `Normalized email ${email} is used by more than one source user`,
      });
      rejectedCounts.users += 1;
      continue;
    }
    normalizedEmails.add(email);
    const postgresId = deterministicUuid('owezy-legacy-user', id);
    users.push({ id: postgresId, legacyId: id, firebaseUid: id, email, name, createdAt });
    mappings.push({ entityType: 'user', legacyId: id, postgresId });
  }
  const usersByLegacyId = new Map(users.map((user) => [user.legacyId, user]));

  for (const { id, document } of uniqueTrips) {
    const ownerMembershipId = legacyId(document.admin_id);
    const owner = ownerMembershipId ? rawMembers.get(ownerMembershipId) : undefined;
    const name = typeof document.name === 'string' ? document.name.trim() : '';
    const roomCode = typeof document.room_code === 'string' ? document.room_code.trim().toUpperCase() : '';
    const createdAt = validDate(document.created_at);
    const updatedAt = validDate(document.updated_at ?? document.created_at);
    if (!ownerMembershipId || !owner || legacyId(owner.trip_id) !== id) {
      issues.push({
        code: 'orphan_trip_owner', entity: 'trip', legacyId: id,
        message: 'Trip owner membership is missing or belongs to another trip',
      });
      rejectedCounts.trips += 1;
      continue;
    }
    if (!name || !roomCode || !createdAt || !updatedAt) {
      issues.push({ code: 'invalid_trip', entity: 'trip', legacyId: id, message: 'Trip fields are invalid' });
      rejectedCounts.trips += 1;
      continue;
    }
    if (normalizedRoomCodes.has(roomCode)) {
      issues.push({
        code: 'duplicate_room_code', entity: 'trip', legacyId: id,
        message: `Normalized room code ${roomCode} is used by more than one source trip`,
      });
      rejectedCounts.trips += 1;
      continue;
    }
    normalizedRoomCodes.add(roomCode);
    trips.push({
      id, name, roomCode, ownerMembershipId, isLocked: Boolean(document.is_locked), createdAt, updatedAt,
    });
    mappings.push({ entityType: 'trip', legacyId: id, postgresId: id });
  }
  const validTripIds = new Set(trips.map(({ id }) => id));

  for (const { id, document } of uniqueMembers) {
    const tripId = legacyId(document.trip_id);
    if (!tripId || !validTripIds.has(tripId)) {
      issues.push({
        code: 'orphan_membership_trip', entity: 'membership', legacyId: id,
        message: 'Membership trip does not exist in the migration plan',
      });
      rejectedCounts.memberships += 1;
      continue;
    }
    const legacyUserId = legacyId(document.user_id);
    const user = legacyUserId ? usersByLegacyId.get(legacyUserId) : undefined;
    if (legacyUserId && !user) {
      issues.push({
        code: 'orphan_membership_user', entity: 'membership', legacyId: id,
        message: 'Membership user does not exist in the migration plan',
      });
      rejectedCounts.memberships += 1;
      continue;
    }
    const displayName = typeof document.name === 'string' ? document.name.trim() : '';
    const createdAt = validDate(document.created_at);
    if (!displayName || !createdAt) {
      issues.push({
        code: 'invalid_membership', entity: 'membership', legacyId: id,
        message: 'Membership fields are invalid',
      });
      rejectedCounts.memberships += 1;
      continue;
    }
    const tripUserKey = user ? `${tripId}\0${user.id}` : null;
    const activeNameKey = `${tripId}\0${displayName.toLowerCase()}`;
    if (tripUserKey && tripUserMemberships.has(tripUserKey)) {
      issues.push({
        code: 'duplicate_trip_user_membership', entity: 'membership', legacyId: id,
        message: 'Source contains more than one active membership for the same trip and user',
      });
      rejectedCounts.memberships += 1;
      continue;
    }
    if (activeMemberNames.has(activeNameKey)) {
      issues.push({
        code: 'duplicate_active_member_name', entity: 'membership', legacyId: id,
        message: 'Source contains case-insensitively duplicate active member names in one trip',
      });
      rejectedCounts.memberships += 1;
      continue;
    }
    if (tripUserKey) tripUserMemberships.add(tripUserKey);
    activeMemberNames.add(activeNameKey);
    memberships.push({
      id,
      tripId,
      userId: user?.id ?? null,
      displayName,
      role: document.is_admin === true ? 'owner' : 'member',
      createdAt,
    });
    mappings.push({ entityType: 'membership', legacyId: id, postgresId: id });
  }
  const membershipsById = new Map(memberships.map((membership) => [membership.id, membership]));

  for (const { id, document } of uniqueExpenses) {
    const tripId = legacyId(document.trip_id);
    const payerId = legacyId(document.paid_by);
    if (!tripId || !validTripIds.has(tripId)) {
      issues.push({ code: 'orphan_expense_trip', entity: 'expense', legacyId: id, message: 'Expense trip is missing' });
      rejectExpense(document);
      continue;
    }
    const payer = payerId ? membershipsById.get(payerId) : undefined;
    if (!payer || payer.tripId !== tripId) {
      issues.push({
        code: 'orphan_expense_payer', entity: 'expense', legacyId: id,
        message: 'Expense payer is missing or belongs to another trip',
      });
      rejectExpense(document);
      continue;
    }
    const totalMinor = exactMinor(document.amount);
    const description = typeof document.description === 'string' ? document.description.trim() : '';
    const splitType = document.split_type ?? 'equal';
    const createdAt = validDate(document.created_at);
    if (
      totalMinor === null
      || !description
      || !createdAt
      || !['equal', 'custom', 'percentage'].includes(String(splitType))
    ) {
      issues.push({ code: 'invalid_expense', entity: 'expense', legacyId: id, message: 'Expense fields are invalid' });
      rejectExpense(document);
      continue;
    }
    if (!Array.isArray(document.splits) || document.splits.length === 0) {
      issues.push({ code: 'invalid_expense_splits', entity: 'expense', legacyId: id, message: 'Expense has no splits' });
      rejectExpense(document);
      continue;
    }
    const splitRows: MigratedExpenseSplit[] = [];
    const splitMembers = new Set<string>();
    let splitInvalid = false;
    for (const split of document.splits as LegacyDocument[]) {
      const membershipId = legacyId(split.member_id);
      const membership = membershipId ? membershipsById.get(membershipId) : undefined;
      const amountMinor = exactMinor(split.amount);
      if (!membership || membership.tripId !== tripId) {
        issues.push({
          code: 'orphan_expense_split_member', entity: 'expense', legacyId: id,
          message: 'Expense split member is missing or belongs to another trip',
        });
        splitInvalid = true;
        break;
      }
      if (amountMinor === null || splitMembers.has(membership.id)) {
        issues.push({
          code: 'invalid_expense_splits', entity: 'expense', legacyId: id,
          message: 'Expense splits contain an invalid amount or duplicate member',
        });
        splitInvalid = true;
        break;
      }
      splitMembers.add(membership.id);
      splitRows.push({ expenseId: id, tripId, membershipId: membership.id, amountMinor });
    }
    if (splitInvalid) {
      rejectExpense(document);
      continue;
    }
    const splitTotal = splitRows.reduce((sum, split) => sum + split.amountMinor, 0n);
    if (splitTotal !== totalMinor) {
      issues.push({
        code: 'split_total_mismatch', entity: 'expense', legacyId: id,
        message: `Expense split total ${splitTotal} does not equal ${totalMinor}`,
      });
      rejectExpense(document);
      continue;
    }

    expenses.push({
      id,
      tripId,
      paidByMembershipId: payer.id,
      description,
      totalMinor,
      splitType: String(splitType) as MigratedExpense['splitType'],
      createdAt,
    });
    expenseSplits.push(...splitRows);
    mappings.push({ entityType: 'expense', legacyId: id, postgresId: id });

    if (document.receipt_url !== undefined && document.receipt_url !== null && document.receipt_url !== '') {
      const receiptLegacyId = `${id}:receipt`;
      const extracted = extractDataUrl(document.receipt_url);
      if (!extracted) {
        issues.push({
          code: 'invalid_receipt_data_url', entity: 'receipt', legacyId: receiptLegacyId,
          message: 'Receipt is not a supported, valid Base64 image data URL',
        });
        rejectedCounts.receipts += 1;
      } else {
        const receiptId = deterministicReceiptId(id);
        receipts.push({
          id: receiptId,
          legacyId: receiptLegacyId,
          expenseId: id,
          tripId,
          uploadedByMembershipId: payer.id,
          contentType: extracted.contentType,
          byteSize: extracted.bytes.length,
          checksumSha256: createHash('sha256').update(extracted.bytes).digest('hex'),
          bytes: extracted.bytes,
          createdAt,
        });
        mappings.push({ entityType: 'receipt', legacyId: receiptLegacyId, postgresId: receiptId });
      }
    }
  }

  for (const { id, document } of uniqueMessages) {
    const tripId = legacyId(document.trip_id);
    const membershipId = legacyId(document.member_id);
    const membership = membershipId ? membershipsById.get(membershipId) : undefined;
    if (!tripId || !validTripIds.has(tripId)) {
      issues.push({ code: 'orphan_message_trip', entity: 'message', legacyId: id, message: 'Message trip is missing' });
      rejectedCounts.messages += 1;
      continue;
    }
    if (!membership || membership.tripId !== tripId) {
      issues.push({
        code: 'orphan_message_member', entity: 'message', legacyId: id,
        message: 'Message member is missing or belongs to another trip',
      });
      rejectedCounts.messages += 1;
      continue;
    }
    const message = typeof document.message === 'string' ? document.message.trim() : '';
    const createdAt = validDate(document.created_at);
    if (!message || !createdAt) {
      issues.push({ code: 'invalid_message', entity: 'message', legacyId: id, message: 'Message fields are invalid' });
      rejectedCounts.messages += 1;
      continue;
    }
    messages.push({ id, tripId, membershipId: membership.id, message, createdAt });
    mappings.push({ entityType: 'message', legacyId: id, postgresId: id });
  }

  const sourceCounts: MigrationCounts = {
    users: snapshot.users.length,
    trips: snapshot.trips.length,
    memberships: snapshot.members.length,
    expenses: snapshot.expenses.length,
    expenseSplits: snapshot.expenses.reduce(
      (count, expense) => count + (Array.isArray(expense.splits) ? expense.splits.length : 0),
      0,
    ),
    receipts: snapshot.expenses.filter(
      (expense) => expense.receipt_url !== undefined && expense.receipt_url !== null && expense.receipt_url !== '',
    ).length,
    messages: snapshot.messages.length,
  };

  return {
    users, trips, memberships, expenses, expenseSplits, receipts, messages, mappings,
    sourceCounts, rejectedCounts, issues,
  };
}

export interface MigrationVerification {
  valid: boolean;
  issues: MigrationIssue[];
  counts: { source: MigrationCounts; transformed: MigrationCounts; rejected: MigrationCounts };
}

export function verifyMigration(plan: MigrationPlan): MigrationVerification {
  const issues = [...plan.issues];
  const transformed = transformedCounts(plan);
  for (const key of Object.keys(plan.sourceCounts) as Array<keyof MigrationCounts>) {
    const accountedFor = transformed[key] + plan.rejectedCounts[key];
    if (accountedFor !== plan.sourceCounts[key]) {
      issues.push({
        code: 'source_reconciliation_mismatch', entity: 'migration', legacyId: key,
        message: `Source has ${plan.sourceCounts[key]} ${key}, but ${transformed[key]} imported and ${plan.rejectedCounts[key]} rejected`,
      });
    }
  }
  const tripIds = new Set(plan.trips.map(({ id }) => id));
  const membershipById = new Map(plan.memberships.map((membership) => [membership.id, membership]));
  const expenseById = new Map(plan.expenses.map((expense) => [expense.id, expense]));

  for (const trip of plan.trips) {
    const owner = membershipById.get(trip.ownerMembershipId);
    const ownerCount = plan.memberships.filter(
      (membership) => membership.tripId === trip.id && membership.role === 'owner',
    ).length;
    if (ownerCount !== 1) {
      issues.push({
        code: 'trip_owner_count_invalid', entity: 'trip', legacyId: trip.id,
        message: `Transformed trip has ${ownerCount} owner memberships`,
      });
    }
    if (!owner || owner.tripId !== trip.id || owner.role !== 'owner') {
      issues.push({
        code: 'orphan_trip_owner', entity: 'trip', legacyId: trip.id,
        message: 'Transformed trip owner reference is invalid',
      });
    }
  }
  for (const membership of plan.memberships) {
    if (!tripIds.has(membership.tripId)) {
      issues.push({
        code: 'orphan_membership_trip', entity: 'membership', legacyId: membership.id,
        message: 'Transformed membership trip reference is invalid',
      });
    }
  }

  const balancesByTrip = new Map<string, Map<string, bigint>>();
  for (const expense of plan.expenses) {
    const payer = membershipById.get(expense.paidByMembershipId);
    if (!payer || payer.tripId !== expense.tripId) {
      issues.push({
        code: 'orphan_expense_payer', entity: 'expense', legacyId: expense.id,
        message: 'Transformed expense payer reference is invalid',
      });
      continue;
    }
    const splits = plan.expenseSplits.filter((split) => split.expenseId === expense.id);
    const splitTotal = splits.reduce((sum, split) => sum + split.amountMinor, 0n);
    if (splitTotal !== expense.totalMinor) {
      issues.push({
        code: 'split_total_mismatch', entity: 'expense', legacyId: expense.id,
        message: `Transformed split total ${splitTotal} does not equal ${expense.totalMinor}`,
      });
    }
    const balances = balancesByTrip.get(expense.tripId) ?? new Map<string, bigint>();
    balancesByTrip.set(expense.tripId, balances);
    balances.set(payer.id, (balances.get(payer.id) ?? 0n) + expense.totalMinor);
    for (const split of splits) {
      const membership = membershipById.get(split.membershipId);
      if (!membership || membership.tripId !== expense.tripId) {
        issues.push({
          code: 'orphan_expense_split_member', entity: 'expense', legacyId: expense.id,
          message: 'Transformed expense split reference is invalid',
        });
        continue;
      }
      balances.set(split.membershipId, (balances.get(split.membershipId) ?? 0n) - split.amountMinor);
    }
  }
  for (const receipt of plan.receipts) {
    const expense = expenseById.get(receipt.expenseId);
    if (!expense || expense.tripId !== receipt.tripId) {
      issues.push({
        code: 'orphan_receipt_expense', entity: 'receipt', legacyId: receipt.legacyId,
        message: 'Transformed receipt expense reference is invalid',
      });
    }
  }
  for (const [tripId, balances] of balancesByTrip) {
    const total = [...balances.values()].reduce((sum, value) => sum + value, 0n);
    if (total !== 0n) {
      issues.push({
        code: 'trip_balance_nonzero', entity: 'trip', legacyId: tripId,
        message: `Trip ledger sums to ${total} minor units`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    counts: { source: plan.sourceCounts, transformed, rejected: plan.rejectedCounts },
  };
}

export interface MigrationTarget {
  apply(plan: MigrationPlan, storage: ReceiptStorage): Promise<void>;
  verify(plan: MigrationPlan, storage: ReceiptStorage): Promise<MigrationIssue[]>;
}

async function upsertMapping(
  database: QueryExecutor,
  mapping: LegacyMapping,
): Promise<void> {
  await database.query(
    `INSERT INTO legacy_id_mappings (entity_type, legacy_id, postgres_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (entity_type, legacy_id)
     DO UPDATE SET postgres_id = EXCLUDED.postgres_id, migrated_at = now()`,
    [mapping.entityType, mapping.legacyId, mapping.postgresId],
  );
}

export class MigrationReceiptCleanupError extends Error {
  readonly transactionError: unknown;
  readonly cleanupErrors: unknown[];

  constructor(transactionError: unknown, cleanupErrors: unknown[]) {
    super('Migration transaction failed and receipt storage cleanup also failed');
    this.name = 'MigrationReceiptCleanupError';
    this.transactionError = transactionError;
    this.cleanupErrors = cleanupErrors;
  }
}

function receiptMetadataMatches(row: Record<string, unknown>, receipt: MigratedReceipt): boolean {
  return String(row.id) === receipt.id
    && String(row.expense_id) === receipt.expenseId
    && String(row.trip_id) === receipt.tripId
    && String(row.uploaded_by_membership_id) === receipt.uploadedByMembershipId
    && String(row.content_type) === receipt.contentType
    && Number(row.byte_size) === receipt.byteSize
    && String(row.checksum_sha256) === receipt.checksumSha256
    && String(row.status) === 'attached';
}

function receiptBytesMatch(bytes: Buffer, receipt: MigratedReceipt): boolean {
  return bytes.length === receipt.byteSize
    && createHash('sha256').update(bytes).digest('hex') === receipt.checksumSha256
    && bytes.equals(receipt.bytes);
}

export class PostgresMigrationTarget implements MigrationTarget {
  constructor(
    private readonly database: QueryExecutor = defaultDatabase(),
    private readonly transaction: TransactionRunner = defaultTransaction,
  ) {}

  async apply(plan: MigrationPlan, storage: ReceiptStorage): Promise<void> {
    const actualUserIds = new Map<string, string>();
    await this.transaction(async (database) => {
      for (const user of plan.users) {
        const result = await database.query(
          `INSERT INTO users (id, firebase_uid, email, name, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (firebase_uid)
           DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
           RETURNING id`,
          [user.id, user.firebaseUid, user.email, user.name, user.createdAt],
        );
        const postgresId = String(result.rows[0]?.id ?? user.id);
        actualUserIds.set(user.id, postgresId);
        await upsertMapping(database, {
          entityType: 'user', legacyId: user.legacyId, postgresId,
        });
      }
    });

    for (const trip of plan.trips) {
      const storedKeys: string[] = [];
      try {
        await this.transaction(async (database) => {
          await database.query(
            `INSERT INTO trips
               (id, name, room_code, owner_membership_id, is_locked, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id)
             DO UPDATE SET name = EXCLUDED.name,
                           room_code = EXCLUDED.room_code,
                           owner_membership_id = EXCLUDED.owner_membership_id,
                           is_locked = EXCLUDED.is_locked,
                           updated_at = EXCLUDED.updated_at`,
            [
              trip.id, trip.name, trip.roomCode, trip.ownerMembershipId, trip.isLocked,
              trip.createdAt, trip.updatedAt,
            ],
          );
          await upsertMapping(database, {
            entityType: 'trip', legacyId: trip.id, postgresId: trip.id,
          });

          for (const membership of plan.memberships.filter(({ tripId }) => tripId === trip.id)) {
            await database.query(
              `INSERT INTO trip_memberships
                 (id, trip_id, user_id, display_name, role, status, created_at)
               VALUES ($1, $2, $3, $4, $5, 'active', $6)
               ON CONFLICT (id)
               DO UPDATE SET user_id = EXCLUDED.user_id,
                             display_name = EXCLUDED.display_name,
                             role = EXCLUDED.role,
                             status = 'active',
                             left_at = NULL`,
              [
                membership.id,
                membership.tripId,
                membership.userId ? actualUserIds.get(membership.userId) ?? membership.userId : null,
                membership.displayName,
                membership.role,
                membership.createdAt,
              ],
            );
            await upsertMapping(database, {
              entityType: 'membership', legacyId: membership.id, postgresId: membership.id,
            });
          }

          for (const expense of plan.expenses.filter(({ tripId }) => tripId === trip.id)) {
            await database.query(
              `INSERT INTO expenses
                 (id, trip_id, paid_by_membership_id, description, total_minor, currency, split_type, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, 'INR', $6, $7, $7)
               ON CONFLICT (id)
               DO UPDATE SET paid_by_membership_id = EXCLUDED.paid_by_membership_id,
                             description = EXCLUDED.description,
                             total_minor = EXCLUDED.total_minor,
                             split_type = EXCLUDED.split_type,
                             updated_at = EXCLUDED.updated_at`,
              [
                expense.id, expense.tripId, expense.paidByMembershipId, expense.description,
                expense.totalMinor, expense.splitType, expense.createdAt,
              ],
            );
            await upsertMapping(database, {
              entityType: 'expense', legacyId: expense.id, postgresId: expense.id,
            });

            for (const split of plan.expenseSplits.filter(({ expenseId }) => expenseId === expense.id)) {
              await database.query(
                `INSERT INTO expense_splits (expense_id, trip_id, membership_id, amount_minor)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (expense_id, membership_id)
                 DO UPDATE SET trip_id = EXCLUDED.trip_id, amount_minor = EXCLUDED.amount_minor`,
                [split.expenseId, split.tripId, split.membershipId, split.amountMinor],
              );
            }
          }

          for (const receipt of plan.receipts.filter(({ tripId }) => tripId === trip.id)) {
            const existingMapping = await database.query(
              `SELECT postgres_id FROM legacy_id_mappings
                WHERE entity_type = 'receipt' AND legacy_id = $1`,
              [receipt.legacyId],
            );
            const mappedId = existingMapping.rows[0]?.postgres_id;
            if (mappedId !== undefined && String(mappedId) !== receipt.id) {
              throw new Error(
                `Receipt mapping identity mismatch for ${receipt.legacyId}: expected ${receipt.id}, found ${mappedId}`,
              );
            }

            const existingReceipt = await database.query(
              `SELECT id, expense_id, trip_id, uploaded_by_membership_id, storage_key,
                      content_type, byte_size, checksum_sha256, status
                 FROM receipts
                WHERE id = $1`,
              [receipt.id],
            );
            const receiptRow = existingReceipt.rows[0] as Record<string, unknown> | undefined;
            if (receiptRow && !receiptMetadataMatches(receiptRow, receipt)) {
              throw new Error(`Receipt target metadata mismatch for ${receipt.legacyId}`);
            }
            if (receiptRow) {
              try {
                const storedBytes = await storage.read(String(receiptRow.storage_key));
                if (receiptBytesMatch(storedBytes, receipt)) {
                  if (mappedId === undefined) {
                    await upsertMapping(database, {
                      entityType: 'receipt', legacyId: receipt.legacyId, postgresId: receipt.id,
                    });
                  }
                  continue;
                }
              } catch {
                // A deterministic rewrite below repairs a missing or unreadable object.
              }
            }

            const { storageKey } = await storage.write(
              receipt.bytes,
              receipt.contentType,
              receipt.id,
            );
            storedKeys.push(storageKey);
            await database.query(
              `INSERT INTO receipts
                 (id, expense_id, trip_id, uploaded_by_membership_id, storage_key, content_type,
                  byte_size, checksum_sha256, status, created_at, pending_expires_at, attached_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'attached', $9, NULL, $9)
               ON CONFLICT (id)
               DO UPDATE SET expense_id = EXCLUDED.expense_id,
                             trip_id = EXCLUDED.trip_id,
                             uploaded_by_membership_id = EXCLUDED.uploaded_by_membership_id,
                             storage_key = EXCLUDED.storage_key,
                             content_type = EXCLUDED.content_type,
                             byte_size = EXCLUDED.byte_size,
                             checksum_sha256 = EXCLUDED.checksum_sha256,
                             status = 'attached',
                             pending_expires_at = NULL,
                             attached_at = EXCLUDED.attached_at`,
              [
                receipt.id, receipt.expenseId, receipt.tripId, receipt.uploadedByMembershipId,
                storageKey, receipt.contentType, receipt.byteSize, receipt.checksumSha256,
                receipt.createdAt,
              ],
            );
            await upsertMapping(database, {
              entityType: 'receipt', legacyId: receipt.legacyId, postgresId: receipt.id,
            });
          }

          for (const message of plan.messages.filter(({ tripId }) => tripId === trip.id)) {
            await database.query(
              `INSERT INTO chat_messages (id, trip_id, membership_id, message, created_at)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (id)
               DO UPDATE SET membership_id = EXCLUDED.membership_id,
                             message = EXCLUDED.message,
                             created_at = EXCLUDED.created_at`,
              [message.id, message.tripId, message.membershipId, message.message, message.createdAt],
            );
            await upsertMapping(database, {
              entityType: 'message', legacyId: message.id, postgresId: message.id,
            });
          }
        });
      } catch (error) {
        const cleanupResults = await Promise.allSettled(
          storedKeys.map((storageKey) => storage.remove(storageKey)),
        );
        const cleanupErrors = cleanupResults
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason);
        if (cleanupErrors.length > 0) {
          throw new MigrationReceiptCleanupError(error, cleanupErrors);
        }
        throw error;
      }
    }
  }

  async verify(plan: MigrationPlan, storage: ReceiptStorage): Promise<MigrationIssue[]> {
    const issues: MigrationIssue[] = [];
    const countsResult = await this.database.query(`
      SELECT
        (SELECT count(*)
           FROM legacy_id_mappings user_map
           JOIN users user_target ON user_target.id::text = user_map.postgres_id
          WHERE user_map.entity_type = 'user' AND user_map.legacy_id = ANY($1::text[])) AS users,
        (SELECT count(*)
           FROM legacy_id_mappings trip_map
           JOIN trips trip_target ON trip_target.id::text = trip_map.postgres_id
          WHERE trip_map.entity_type = 'trip' AND trip_map.legacy_id = ANY($2::text[])) AS trips,
        (SELECT count(*)
           FROM legacy_id_mappings membership_map
           JOIN trip_memberships membership_target ON membership_target.id::text = membership_map.postgres_id
          WHERE membership_map.entity_type = 'membership'
            AND membership_map.legacy_id = ANY($3::text[])) AS memberships,
        (SELECT count(*)
           FROM legacy_id_mappings expense_map
           JOIN expenses expense_target ON expense_target.id::text = expense_map.postgres_id
          WHERE expense_map.entity_type = 'expense'
            AND expense_map.legacy_id = ANY($4::text[])) AS expenses,
        (SELECT count(*)
           FROM expense_splits s
           JOIN legacy_id_mappings expense_map
             ON expense_map.entity_type = 'expense'
            AND expense_map.postgres_id = s.expense_id::text
            AND expense_map.legacy_id = ANY($4::text[])) AS expense_splits,
        (SELECT count(*)
           FROM legacy_id_mappings receipt_map
           JOIN receipts receipt_target ON receipt_target.id::text = receipt_map.postgres_id
          WHERE receipt_map.entity_type = 'receipt'
            AND receipt_map.legacy_id = ANY($5::text[])) AS receipts,
        (SELECT count(*)
           FROM legacy_id_mappings message_map
           JOIN chat_messages message_target ON message_target.id::text = message_map.postgres_id
          WHERE message_map.entity_type = 'message'
            AND message_map.legacy_id = ANY($6::text[])) AS messages
    `, [
      plan.users.map(({ legacyId: id }) => id),
      plan.trips.map(({ id }) => id),
      plan.memberships.map(({ id }) => id),
      plan.expenses.map(({ id }) => id),
      plan.receipts.map(({ legacyId: id }) => id),
      plan.messages.map(({ id }) => id),
    ]);
    const expected = transformedCounts(plan);
    const actualRow = countsResult.rows[0] ?? {};
    for (const key of Object.keys(expected) as Array<keyof MigrationCounts>) {
      const databaseKey = key === 'expenseSplits' ? 'expense_splits' : key;
      const actual = Number(actualRow[databaseKey] ?? 0);
      if (actual !== expected[key]) {
        issues.push({
          code: 'database_count_mismatch',
          entity: 'migration',
          legacyId: key,
          message: `Expected ${expected[key]} ${key}, found ${actual}`,
        });
      }
    }

    for (const receipt of plan.receipts) {
      const receiptResult = await this.database.query(
        `SELECT m.postgres_id, r.id, r.expense_id, r.trip_id, r.uploaded_by_membership_id,
                r.storage_key, r.content_type, r.byte_size, r.checksum_sha256, r.status
           FROM legacy_id_mappings m
           LEFT JOIN receipts r ON r.id::text = m.postgres_id
          WHERE m.entity_type = 'receipt' AND m.legacy_id = $1`,
        [receipt.legacyId],
      );
      const row = receiptResult.rows[0] as Record<string, unknown> | undefined;
      if (!row || String(row.postgres_id) !== receipt.id) {
        issues.push({
          code: 'database_receipt_mapping_invalid', entity: 'receipt', legacyId: receipt.legacyId,
          message: `Receipt mapping does not resolve to expected target ${receipt.id}`,
        });
        continue;
      }
      if (!receiptMetadataMatches(row, receipt)) {
        issues.push({
          code: 'database_receipt_metadata_invalid', entity: 'receipt', legacyId: receipt.legacyId,
          message: 'Persisted receipt metadata does not match the transformed source receipt',
        });
        continue;
      }
      try {
        const bytes = await storage.read(String(row.storage_key));
        if (!receiptBytesMatch(bytes, receipt)) throw new Error('checksum or byte size mismatch');
      } catch (error) {
        issues.push({
          code: 'database_receipt_object_invalid', entity: 'receipt', legacyId: receipt.legacyId,
          message: `Persisted receipt object is missing or corrupt: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    const referenceResult = await this.database.query(`
      SELECT count(*) AS orphan_count
        FROM (
          SELECT t.id
            FROM trips t
            JOIN legacy_id_mappings map ON map.entity_type = 'trip' AND map.postgres_id = t.id
            LEFT JOIN trip_memberships owner
              ON owner.id = t.owner_membership_id AND owner.trip_id = t.id
           WHERE owner.id IS NULL
          UNION ALL
          SELECT e.id
            FROM expenses e
            JOIN legacy_id_mappings map ON map.entity_type = 'expense' AND map.postgres_id = e.id
            LEFT JOIN trip_memberships payer
              ON payer.id = e.paid_by_membership_id AND payer.trip_id = e.trip_id
           WHERE payer.id IS NULL
          UNION ALL
          SELECT r.id
            FROM receipts r
            JOIN legacy_id_mappings map ON map.entity_type = 'receipt' AND map.postgres_id = r.id
            LEFT JOIN expenses e ON e.id = r.expense_id AND e.trip_id = r.trip_id
           WHERE e.id IS NULL
        ) orphaned
    `);
    const orphanCount = Number(referenceResult.rows[0]?.orphan_count ?? 0);
    if (orphanCount !== 0) {
      issues.push({
        code: 'database_orphan_reference', entity: 'migration', legacyId: 'references',
        message: `Found ${orphanCount} orphaned migrated references`,
      });
    }

    const splitResult = await this.database.query(`
      SELECT e.id
        FROM expenses e
        JOIN legacy_id_mappings map ON map.entity_type = 'expense' AND map.postgres_id = e.id
        LEFT JOIN expense_splits s ON s.expense_id = e.id
       GROUP BY e.id, e.total_minor
      HAVING sum(s.amount_minor) IS DISTINCT FROM e.total_minor
    `);
    for (const row of splitResult.rows) {
      issues.push({
        code: 'database_split_total_mismatch', entity: 'expense', legacyId: String(row.id),
        message: 'Persisted expense splits do not equal the expense total',
      });
    }

    const balanceResult = await this.database.query(`
      WITH deltas AS (
        SELECT e.trip_id, e.total_minor AS delta
          FROM expenses e
          JOIN legacy_id_mappings map ON map.entity_type = 'expense' AND map.postgres_id = e.id
        UNION ALL
        SELECT e.trip_id, -s.amount_minor AS delta
          FROM expenses e
          JOIN legacy_id_mappings map ON map.entity_type = 'expense' AND map.postgres_id = e.id
          JOIN expense_splits s ON s.expense_id = e.id
      )
      SELECT trip_id, sum(delta) AS balance_minor
        FROM deltas
       GROUP BY trip_id
      HAVING sum(delta) <> 0
    `);
    for (const row of balanceResult.rows) {
      issues.push({
        code: 'database_trip_balance_nonzero', entity: 'trip', legacyId: String(row.trip_id),
        message: `Persisted trip ledger sums to ${row.balance_minor} minor units`,
      });
    }
    return issues;
  }
}

export interface ExecuteMigrationOptions {
  dryRun: boolean;
  target: MigrationTarget;
  storage: ReceiptStorage;
}

export interface ExecuteMigrationResult {
  ok: boolean;
  dryRun: boolean;
  issues: MigrationIssue[];
  counts: MigrationVerification['counts'];
}

export async function executeMigration(
  plan: MigrationPlan,
  options: ExecuteMigrationOptions,
): Promise<ExecuteMigrationResult> {
  const preflight = verifyMigration(plan);
  if (!preflight.valid || options.dryRun) {
    return {
      ok: preflight.valid,
      dryRun: options.dryRun,
      issues: preflight.issues,
      counts: preflight.counts,
    };
  }

  await options.target.apply(plan, options.storage);
  const databaseIssues = await options.target.verify(plan, options.storage);
  return {
    ok: databaseIssues.length === 0,
    dryRun: false,
    issues: databaseIssues,
    counts: preflight.counts,
  };
}

export interface LegacyMongoSource {
  collection(name: string): {
    find(): { toArray(): Promise<LegacyDocument[]> };
  };
}

export async function loadLegacySnapshot(source: LegacyMongoSource): Promise<LegacySnapshot> {
  const [users, trips, members, expenses, messages] = await Promise.all([
    source.collection('users').find().toArray(),
    source.collection('trips').find().toArray(),
    source.collection('members').find().toArray(),
    source.collection('expenses').find().toArray(),
    source.collection('chatmessages').find().toArray(),
  ]);
  return { users, trips, members, expenses, messages };
}

export interface MigrationCliOptions {
  dryRun: boolean;
  mongodbUri: string;
  mongodbDatabase?: string;
}

export function parseMigrationCliOptions(
  arguments_: string[],
  environment: Record<string, string | undefined> = process.env,
): MigrationCliOptions {
  for (const argument of arguments_) {
    if (argument !== '--dry-run') throw new Error(`Unknown argument: ${argument}`);
  }
  const mongodbUri = environment.MONGODB_URI?.trim();
  if (!mongodbUri) throw new Error('MONGODB_URI is required for the migration source');
  if (!environment.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required for the migration target');
  const mongodbDatabase = environment.MONGODB_DATABASE?.trim();
  return {
    dryRun: arguments_.includes('--dry-run'),
    mongodbUri,
    ...(mongodbDatabase ? { mongodbDatabase } : {}),
  };
}

export async function runMigrationCli(
  arguments_: string[] = process.argv.slice(2),
  environment: Record<string, string | undefined> = process.env,
): Promise<ExecuteMigrationResult> {
  const options = parseMigrationCliOptions(arguments_, environment);
  const mongo = new MongoClient(options.mongodbUri);
  try {
    await mongo.connect();
    const snapshot = await loadLegacySnapshot(
      mongo.db(options.mongodbDatabase) as unknown as LegacyMongoSource,
    );
    const plan = transformLegacySnapshot(snapshot);
    const storageConfig = getReceiptStorageConfig(environment);
    const storage = storageConfig.root
      ? new LocalReceiptStorage(storageConfig.root)
      : new DisabledReceiptStorage();
    const result = await executeMigration(plan, {
      dryRun: options.dryRun,
      target: new PostgresMigrationTarget(),
      storage,
    });
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await mongo.close();
    await shutdownDatabase();
  }
}

if (require.main === module) {
  runMigrationCli().then((result) => {
    if (!result.ok) process.exitCode = 1;
  }).catch((error: unknown) => {
    console.error('[MIGRATION] Failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
