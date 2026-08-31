import type { ReceiptStorage } from '../storage/receiptStorage';
import { createReceiptStorage } from '../storage/createReceiptStorage';
import { getReceiptStorageConfig } from '../storage/receiptStorage';
import { getPool } from '../database';

export interface ReceiptMetadata { id: string; storageKey: string }

export interface ReceiptReconcileRepository {
  listMetadata(limit: number, afterId?: string): Promise<ReceiptMetadata[]>;
  findKnownKeys(keys: string[]): Promise<string[]>;
}

export interface ReceiptReconcileDependencies {
  repository: ReceiptReconcileRepository;
  storage: ReceiptStorage;
}

export class PostgresReceiptReconcileRepository implements ReceiptReconcileRepository {
  async listMetadata(limit: number, afterId?: string): Promise<ReceiptMetadata[]> {
    const result = await getPool().query(
      `SELECT id, storage_key
         FROM receipts
        WHERE ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id
        LIMIT $1`,
      [limit, afterId ?? null],
    );
    return result.rows.map((row) => ({ id: row.id, storageKey: row.storage_key }));
  }

  async findKnownKeys(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const result = await getPool().query(
      `SELECT storage_key FROM receipts WHERE storage_key = ANY($1::text[])`,
      [keys],
    );
    return result.rows.map((row) => row.storage_key);
  }
}

export async function reconcileReceipts(
  options: { limit: number; metadataAfter?: string; objectCursor?: string },
  dependencies?: ReceiptReconcileDependencies,
) {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
    throw new Error('Reconciliation limit must be an integer between 1 and 1000');
  }
  const resolved = dependencies ?? {
    repository: new PostgresReceiptReconcileRepository(),
    storage: createReceiptStorage(getReceiptStorageConfig()),
  };
  if (!resolved.storage.exists || !resolved.storage.list) {
    throw new Error('Receipt storage driver does not support reconciliation');
  }
  const metadata = await resolved.repository.listMetadata(options.limit, options.metadataAfter);
  const missing: ReceiptMetadata[] = [];
  for (const receipt of metadata) {
    if (!await resolved.storage.exists(receipt.storageKey)) missing.push(receipt);
  }
  const objectPage = await resolved.storage.list(options.objectCursor, options.limit);
  const known = new Set(await resolved.repository.findKnownKeys(objectPage.keys));
  const orphaned = objectPage.keys.filter((key) => !known.has(key));
  return {
    metadataScanned: metadata.length,
    objectsScanned: objectPage.keys.length,
    missing,
    orphaned,
    ...(metadata.length === options.limit ? { nextMetadataAfter: metadata[metadata.length - 1].id } : {}),
    ...(objectPage.nextCursor ? { nextObjectCursor: objectPage.nextCursor } : {}),
  };
}
