import { createHash } from 'node:crypto';
import type { QueryExecutor, TransactionRunner } from '../repositories/database';
import { defaultTransaction } from '../repositories/database';
import { generateId } from '../utils/helpers';
import { ServiceError } from './errors';

export interface IdempotentResponse<T = unknown> {
  replayed: boolean;
  status: number;
  body: T;
}

export type IdempotentWork<T> = (
  database: QueryExecutor,
) => Promise<{ status: number; body: T }>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

function requestHash(payload: unknown): string {
  const serialized = JSON.stringify(canonicalize(payload));
  if (serialized === undefined) throw new ServiceError(400, 'Idempotent payload must be JSON serializable');
  return createHash('sha256').update(serialized).digest('hex');
}

export class IdempotencyService {
  constructor(
    private readonly transaction: TransactionRunner = defaultTransaction,
    private readonly createId: () => string = generateId,
  ) {}

  execute<T>(
    actorMembershipId: string,
    operation: string,
    key: string,
    payload: unknown,
    work: IdempotentWork<T>,
  ): Promise<IdempotentResponse<T>> {
    const normalizedKey = key?.trim();
    if (!normalizedKey || normalizedKey.length > 128) {
      throw new ServiceError(400, 'Idempotency-Key is required and must be at most 128 characters');
    }
    const hash = requestHash(payload);

    return this.transaction(async (database) => {
      const inserted = await database.query(
        `INSERT INTO idempotency_records
           (id, actor_membership_id, operation, idempotency_key, request_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (actor_membership_id, operation, idempotency_key) DO NOTHING
         RETURNING id`,
        [this.createId(), actorMembershipId, operation, normalizedKey, hash],
      );

      if (inserted.rowCount === 0) {
        const existing = await database.query(
          `SELECT request_hash, response_status, response_body, completed_at
             FROM idempotency_records
            WHERE actor_membership_id = $1
              AND operation = $2
              AND idempotency_key = $3
            FOR UPDATE`,
          [actorMembershipId, operation, normalizedKey],
        );
        const record = existing.rows[0];
        if (!record || record.request_hash !== hash) {
          throw new ServiceError(409, 'Idempotency-Key was already used with a different request');
        }
        if (!record.completed_at || record.response_status === null || record.response_status === undefined) {
          throw new ServiceError(409, 'An identical request is already in progress');
        }
        return {
          replayed: true,
          status: Number(record.response_status),
          body: record.response_body as T,
        };
      }

      const result = await work(database);
      await database.query(
        `UPDATE idempotency_records
            SET response_status = $2,
                response_body = $3::jsonb,
                completed_at = now()
          WHERE id = $1 AND completed_at IS NULL`,
        [inserted.rows[0].id, result.status, JSON.stringify(result.body)],
      );
      return { replayed: false, ...result };
    });
  }
}
