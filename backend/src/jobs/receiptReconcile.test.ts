import { describe, expect, it } from 'vitest';
import { reconcileReceipts } from './receiptReconcile';

describe('reconcileReceipts', () => {
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
