import { describe, expect, it, vi } from 'vitest';
import { PostgresReceiptReconcileRepository, reconcileReceipts } from './receiptReconcile';

const pool = vi.hoisted(() => ({ query: vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [] })) }));
vi.mock('../database', () => ({ getPool: () => pool }));

describe('reconcileReceipts', () => {
  it('treats opaque receipt cursors as text', async () => {
    await new PostgresReceiptReconcileRepository().listMetadata(10, 'receipt-opaque-1');
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toContain('$2::text');
    expect(sql).not.toContain('$2::uuid');
    expect(values).toEqual([10, 'receipt-opaque-1']);
  });
  it('reports missing metadata targets and orphaned objects without mutating storage', async () => {
    const result = await reconcileReceipts(
      { limit: 10 },
      {
        repository: {
          async listMetadata() {
            return [{ id: 'receipt-1', storageKey: 'present.jpg' }, { id: 'receipt-2', storageKey: 'missing.jpg' }];
          },
          async findKnownKeys(keys) { return keys.filter((key) => key === 'present.jpg'); },
        },
        storage: {
          async write() { throw new Error('must not write'); },
          async read() { throw new Error('must not read bodies'); },
          async remove() { throw new Error('must not remove'); },
          async exists(key) { return key === 'present.jpg'; },
          async list() { return { keys: ['present.jpg', 'orphan.jpg'], nextCursor: 'page-2' }; },
        },
      },
    );

    expect(result).toEqual({
      metadataScanned: 2,
      objectsScanned: 2,
      missing: [{ id: 'receipt-2', storageKey: 'missing.jpg' }],
      orphaned: ['orphan.jpg'],
      nextObjectCursor: 'page-2',
    });
  });

  it('requires bounded reconciliation capabilities from the storage driver', async () => {
    await expect(reconcileReceipts({ limit: 10 }, {
      repository: { async listMetadata() { return []; }, async findKnownKeys() { return []; } },
      storage: { async write() { return { storageKey: '' }; }, async read() { return Buffer.alloc(0); }, async remove() {} },
    })).rejects.toThrow(/reconciliation/i);
  });
});
