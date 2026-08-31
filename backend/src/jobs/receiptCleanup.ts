import type { ReceiptStorage } from '../storage/receiptStorage';
import { createReceiptStorage } from '../storage/createReceiptStorage';
import { getReceiptStorageConfig } from '../storage/receiptStorage';
import {
  defaultTransaction,
  TransactionRunner,
} from '../repositories/database';

export interface CleanupReceipt { id: string; storageKey: string }

export interface ReceiptCleanupSession {
  listExpired(limit: number): Promise<CleanupReceipt[]>;
  deleteExpired(id: string): Promise<boolean>;
}

export interface ReceiptCleanupRepository {
  withLock<T>(work: (session: ReceiptCleanupSession) => Promise<T>): Promise<T | null>;
}

export interface ReceiptCleanupDependencies {
  repository: ReceiptCleanupRepository;
  storage: ReceiptStorage;
}

export class PostgresReceiptCleanupRepository implements ReceiptCleanupRepository {
  constructor(private readonly transaction: TransactionRunner = defaultTransaction) {}

  withLock<T>(work: (session: ReceiptCleanupSession) => Promise<T>): Promise<T | null> {
    return this.transaction(async (database) => {
      const acquired = await database.query(
        `SELECT pg_try_advisory_xact_lock(hashtext('owezy.receipt_cleanup')) AS acquired`,
      );
      if (!acquired.rows[0]?.acquired) return null;
      return work({
        async listExpired(limit) {
          const result = await database.query(
            `SELECT id, storage_key
               FROM receipts
              WHERE status = 'pending' AND pending_expires_at <= now()
              ORDER BY pending_expires_at, id
              LIMIT $1
              FOR UPDATE SKIP LOCKED`,
            [limit],
          );
          return result.rows.map((row) => ({ id: row.id, storageKey: row.storage_key }));
        },
        async deleteExpired(id) {
          const result = await database.query(
            `DELETE FROM receipts
              WHERE id = $1 AND status = 'pending' AND pending_expires_at <= now()`,
            [id],
          );
          return result.rowCount === 1;
        },
      });
    });
  }
}

export async function cleanupExpiredReceipts(
  options: { dryRun: boolean; limit: number },
  dependencies?: ReceiptCleanupDependencies,
): Promise<{ scanned: number; removed: number; failed: number }> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
    throw new Error('Cleanup limit must be an integer between 1 and 1000');
  }
  const resolved = dependencies ?? {
    repository: new PostgresReceiptCleanupRepository(),
    storage: createReceiptStorage(getReceiptStorageConfig()),
  };
  const result = await resolved.repository.withLock(async (session) => {
    const receipts = await session.listExpired(options.limit);
    let removed = 0;
    let failed = 0;
    if (!options.dryRun) {
      for (const receipt of receipts) {
        try {
          await resolved.storage.remove(receipt.storageKey);
          if (await session.deleteExpired(receipt.id)) removed += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
    }
    return { scanned: receipts.length, removed, failed };
  });
  return result ?? { scanned: 0, removed: 0, failed: 0 };
}
