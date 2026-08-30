import { describe, expect, it } from 'vitest';
import { PostgresReceiptRepository } from './receiptRepository';

describe('PostgresReceiptRepository', () => {
  it('creates pending metadata only while the uploader membership remains active in the trip', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const database = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text: text.replace(/\s+/g, ' ').trim(), values });
        return { rows: [{ id: 'receipt-1' }], rowCount: 1 };
      },
    };
    const repository = new PostgresReceiptRepository(database);

    await expect(repository.createPending({
      id: 'receipt-1', tripId: 'trip-1', uploadedByMembershipId: 'member-1',
      storageKey: 'generated.png', contentType: 'image/png', byteSize: 8,
      checksumSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pendingExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    })).resolves.toBe(true);

    expect(queries[0].text).toContain('INSERT INTO receipts');
    expect(queries[0].text).toContain('SELECT $1, $2, $3');
    expect(queries[0].text).toContain("m.status = 'active'");
    expect(queries[0].values).toEqual([
      'receipt-1', 'trip-1', 'member-1', 'generated.png', 'image/png', 8,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      new Date('2026-09-01T00:00:00.000Z'),
    ]);
  });

  it('reports a membership race when the guarded insert writes no row', async () => {
    const repository = new PostgresReceiptRepository({
      async query() { return { rows: [], rowCount: 0 }; },
    });

    await expect(repository.createPending({
      id: 'receipt-1', tripId: 'trip-1', uploadedByMembershipId: 'member-1',
      storageKey: 'generated.png', contentType: 'image/png', byteSize: 8,
      checksumSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pendingExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    })).resolves.toBe(false);
  });

  it('loads a receipt only within its requested trip', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const repository = new PostgresReceiptRepository({
      async query(text: string, values?: unknown[]) {
        queries.push({ text: text.replace(/\s+/g, ' ').trim(), values });
        return {
          rows: [{
            id: 'receipt-1', trip_id: 'trip-1', uploaded_by_membership_id: 'member-1',
            storage_key: 'generated.png', content_type: 'image/png', byte_size: '8',
            checksum_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            status: 'attached', pending_expires_at: null,
          }],
          rowCount: 1,
        };
      },
    });

    await expect(repository.findForTrip('receipt-1', 'trip-1')).resolves.toEqual({
      id: 'receipt-1', tripId: 'trip-1', uploadedByMembershipId: 'member-1',
      storageKey: 'generated.png', contentType: 'image/png', byteSize: 8,
      checksumSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'attached', pendingExpiresAt: null,
    });
    expect(queries[0].text).toContain('WHERE id = $1 AND trip_id = $2');
    expect(queries[0].values).toEqual(['receipt-1', 'trip-1']);
  });
});
