import { describe, expect, it } from 'vitest';
import { cleanupExpiredReceipts, type ReceiptCleanupRepository } from './receiptCleanup';

function repository(events: string[]): ReceiptCleanupRepository {
  return {
    async withLock(work) {
      return work({
        async listExpired() {
          return [{ id: 'receipt-1', storageKey: 'abc.jpg' }];
        },
        async deleteExpired(id) {
          events.push(`metadata.delete:${id}`);
          return true;
        },
      });
    },
  };
}

describe('cleanupExpiredReceipts', () => {
  it('yields cleanly when another scheduler owns the advisory lock', async () => {
    const result = await cleanupExpiredReceipts(
      { dryRun: false, limit: 10 },
      {
        repository: { async withLock() { return null; } },
        storage: {
          async write() { return { storageKey: '' }; },
          async read() { return Buffer.alloc(0); },
          async remove() { throw new Error('must not run'); },
        },
      },
    );

    expect(result).toEqual({ scanned: 0, removed: 0, failed: 0 });
  });
  it('removes storage before deleting expired metadata', async () => {
    const events: string[] = [];
    const result = await cleanupExpiredReceipts(
      { dryRun: false, limit: 10 },
      {
        repository: repository(events),
        storage: {
          async write() { return { storageKey: '' }; },
          async read() { return Buffer.alloc(0); },
          async remove(key) { events.push(`storage.remove:${key}`); },
        },
      },
    );

    expect(events).toEqual(['storage.remove:abc.jpg', 'metadata.delete:receipt-1']);
    expect(result).toEqual({ scanned: 1, removed: 1, failed: 0 });
  });

  it('reports candidates without mutating in dry-run mode', async () => {
    const events: string[] = [];
    const result = await cleanupExpiredReceipts(
      { dryRun: true, limit: 10 },
      {
        repository: repository(events),
        storage: {
          async write() { return { storageKey: '' }; },
          async read() { return Buffer.alloc(0); },
          async remove(key) { events.push(`storage.remove:${key}`); },
        },
      },
    );

    expect(result).toEqual({ scanned: 1, removed: 0, failed: 0 });
    expect(events).toEqual([]);
  });
});
