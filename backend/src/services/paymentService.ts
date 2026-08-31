import type { QueryExecutor } from '../repositories/database';
import { majorToMinor } from '../domain/money';
import { generateId } from '../utils/helpers';
import { ServiceError } from './errors';

export type PaymentState = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export interface PaymentRecord {
  id: string;
  status: PaymentState;
  payerMembershipId?: string;
  payeeMembershipId?: string;
  amountMinor?: bigint;
  currency?: string;
  note?: string | null;
}

export type PaymentCreateResult =
  | { kind: 'created'; payment: PaymentRecord }
  | { kind: 'forbidden' | 'invalid-payee' };

export type PaymentTransitionResult =
  | { kind: 'updated'; payment: PaymentRecord }
  | { kind: 'forbidden' | 'not-found' | 'conflict' };

export interface PaymentRepository {
  createForActor(
    firebaseUid: string,
    tripId: string,
    payment: { id: string; payeeMembershipId: string; amountMinor: bigint; note?: string },
    database?: QueryExecutor,
  ): Promise<PaymentCreateResult>;
  transitionForActor(
    firebaseUid: string,
    tripId: string,
    paymentId: string,
    target: Exclude<PaymentState, 'pending'>,
    database?: QueryExecutor,
  ): Promise<PaymentTransitionResult>;
}

function transitionError(result: Exclude<PaymentTransitionResult, { kind: 'updated' }>): never {
  if (result.kind === 'not-found') throw new ServiceError(404, 'Payment not found');
  if (result.kind === 'conflict') throw new ServiceError(409, 'Payment is already in a terminal state');
  throw new ServiceError(403, 'You are not allowed to perform this payment transition');
}

export class PaymentService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly createId: () => string = generateId,
  ) {}

  async create(
    firebaseUid: string,
    tripId: string,
    input: { payeeMembershipId?: unknown; amount?: unknown; note?: unknown },
    database?: QueryExecutor,
  ): Promise<PaymentRecord> {
    if (typeof input?.payeeMembershipId !== 'string' || !input.payeeMembershipId.trim()) {
      throw new ServiceError(400, 'payeeMembershipId is required');
    }
    if (typeof input.amount !== 'string') {
      throw new ServiceError(400, 'amount must be a positive decimal string');
    }
    let amountMinor: bigint;
    try {
      amountMinor = majorToMinor(input.amount);
    } catch {
      throw new ServiceError(400, 'amount must be a positive decimal string');
    }
    if (input.note !== undefined && (typeof input.note !== 'string' || input.note.trim().length > 500)) {
      throw new ServiceError(400, 'note must be at most 500 characters');
    }
    const result = await this.repository.createForActor(firebaseUid, tripId, {
      id: this.createId(),
      payeeMembershipId: input.payeeMembershipId,
      amountMinor,
      ...(typeof input.note === 'string' && input.note.trim() ? { note: input.note.trim() } : {}),
    }, database);
    if (result.kind !== 'created') {
      if (result.kind === 'forbidden') throw new ServiceError(403, 'You are not a member of this trip');
      throw new ServiceError(400, 'Payee must be another active trip member');
    }
    return result.payment;
  }

  confirm(firebaseUid: string, tripId: string, paymentId: string, database?: QueryExecutor) {
    return this.transition(firebaseUid, tripId, paymentId, 'confirmed', database);
  }

  reject(firebaseUid: string, tripId: string, paymentId: string, database?: QueryExecutor) {
    return this.transition(firebaseUid, tripId, paymentId, 'rejected', database);
  }

  cancel(firebaseUid: string, tripId: string, paymentId: string, database?: QueryExecutor) {
    return this.transition(firebaseUid, tripId, paymentId, 'cancelled', database);
  }

  private async transition(
    firebaseUid: string,
    tripId: string,
    paymentId: string,
    target: Exclude<PaymentState, 'pending'>,
    database?: QueryExecutor,
  ): Promise<PaymentRecord> {
    const result = await this.repository.transitionForActor(
      firebaseUid, tripId, paymentId, target, database,
    );
    if (result.kind !== 'updated') transitionError(result);
    return result.payment;
  }
}
