import { describe, expect, it } from 'vitest';
import { Membership } from './tripService';
import {
  NewPendingReceipt,
  ReceiptMetadataRepository,
  ReceiptRecord,
} from '../repositories/receiptRepository';
import { ReceiptStorage, SupportedReceiptContentType } from '../storage/receiptStorage';
import { ReceiptService } from './receiptService';

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const actor: Membership = {
  id: 'member-1',
  tripId: 'trip-1',
  firebaseUid: 'firebase-1',
  name: 'One',
  role: 'member',
  status: 'active',
  createdAt: new Date('2026-08-30T00:00:00.000Z'),
};

class MemoryStorage implements ReceiptStorage {
  readonly objects = new Map<string, Buffer>();

  async write(bytes: Buffer, contentType: SupportedReceiptContentType, objectId?: string) {
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp';
    const storageKey = `${objectId ?? 'generated'}.${extension}`;
    this.objects.set(storageKey, Buffer.from(bytes));
    return { storageKey };
  }

  async read(storageKey: string) {
    const bytes = this.objects.get(storageKey);
    if (!bytes) throw new Error('object missing');
    return Buffer.from(bytes);
  }

  async remove(storageKey: string) {
    this.objects.delete(storageKey);
  }
}

class MemoryReceiptRepository implements ReceiptMetadataRepository {
  pending: NewPendingReceipt | null = null;
  record: ReceiptRecord | null = null;
  failCreate = false;
  actorStillActive = true;

  async createPending(receipt: NewPendingReceipt): Promise<boolean> {
    if (this.failCreate) throw new Error('postgres unavailable');
    if (!this.actorStillActive) return false;
    this.pending = receipt;
    return true;
  }

  async findForTrip(receiptId: string, tripId: string): Promise<ReceiptRecord | null> {
    return this.record?.id === receiptId && this.record.tripId === tripId ? this.record : null;
  }
}

function membershipRepository(activeMembership: Membership | null = actor) {
  return {
    async findActiveMembership(firebaseUid: string, tripId: string) {
      return activeMembership?.firebaseUid === firebaseUid && activeMembership.tripId === tripId
        ? activeMembership
        : null;
    },
  };
}

function service(options: {
  membership?: Membership | null;
  storage?: MemoryStorage;
  repository?: MemoryReceiptRepository;
  maxBytes?: number;
} = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const repository = options.repository ?? new MemoryReceiptRepository();
  return {
    storage,
    repository,
    receiptService: new ReceiptService(
      membershipRepository(options.membership === undefined ? actor : options.membership),
      repository,
      storage,
      { maxBytes: options.maxBytes ?? 1024, pendingTtlHours: 24 },
      () => 'receipt-1',
      () => new Date('2026-08-31T00:00:00.000Z'),
    ),
  };
}

describe('ReceiptService upload', () => {
  it('authorizes through active membership and stores exact image metadata as pending', async () => {
    const { receiptService, repository } = service();

    const result = await receiptService.uploadReceipt(
      'firebase-1',
      'trip-1',
      'image/png',
      pngBytes,
    );

    expect(result).toEqual({
      receiptId: 'receipt-1',
      receiptUrl: '/api/trips/trip-1/receipts/receipt-1',
      contentType: 'image/png',
      byteSize: 8,
      checksumSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
      status: 'pending',
      pendingExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(repository.pending).toEqual({
      id: 'receipt-1',
      tripId: 'trip-1',
      uploadedByMembershipId: 'member-1',
      storageKey: 'receipt-1.png',
      contentType: 'image/png',
      byteSize: 8,
      checksumSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
      pendingExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });
  });

  it('rejects unauthenticated trip actors before accepting receipt bytes', async () => {
    const { receiptService } = service({ membership: null });

    await expect(receiptService.uploadReceipt('outsider', 'trip-1', 'image/png', pngBytes))
      .rejects.toMatchObject({ status: 403, message: 'You are not a member of this trip' });
  });

  it('rejects unsupported, empty, oversized, and mislabeled images', async () => {
    const { receiptService } = service({ maxBytes: 8 });

    await expect(receiptService.uploadReceipt('firebase-1', 'trip-1', 'image/gif', Buffer.from('GIF89a')))
      .rejects.toMatchObject({ status: 415 });
    await expect(receiptService.uploadReceipt('firebase-1', 'trip-1', 'image/png', Buffer.alloc(0)))
      .rejects.toMatchObject({ status: 400 });
    await expect(receiptService.uploadReceipt('firebase-1', 'trip-1', 'image/png', Buffer.concat([pngBytes, Buffer.of(0)])))
      .rejects.toMatchObject({ status: 413 });
    await expect(receiptService.uploadReceipt('firebase-1', 'trip-1', 'image/png', Buffer.from('not png')))
      .rejects.toMatchObject({ status: 415, message: 'Receipt bytes do not match image/png' });
  });

  it('removes the stored object when pending metadata cannot be committed', async () => {
    const storage = new MemoryStorage();
    const repository = new MemoryReceiptRepository();
    repository.failCreate = true;
    const { receiptService } = service({ storage, repository });

    await expect(receiptService.uploadReceipt('firebase-1', 'trip-1', 'image/png', pngBytes))
      .rejects.toThrow('postgres unavailable');
    expect(storage.objects.size).toBe(0);
  });

  it('surfaces storage cleanup failure after metadata persistence fails', async () => {
    const storage = new MemoryStorage();
    storage.remove = async () => { throw new Error('filesystem cleanup failed'); };
    const repository = new MemoryReceiptRepository();
    repository.failCreate = true;
    const { receiptService } = service({ storage, repository });

    await expect(receiptService.uploadReceipt('firebase-1', 'trip-1', 'image/png', pngBytes))
      .rejects.toMatchObject({
        message: 'Receipt metadata persistence failed and storage cleanup also failed',
      });
    expect(storage.objects.size).toBe(1);
  });

  it('removes the stored object if membership becomes inactive before metadata insert', async () => {
    const storage = new MemoryStorage();
    const repository = new MemoryReceiptRepository();
    repository.actorStillActive = false;
    const { receiptService } = service({ storage, repository });

    await expect(receiptService.uploadReceipt('firebase-1', 'trip-1', 'image/png', pngBytes))
      .rejects.toMatchObject({ status: 403 });
    expect(storage.objects.size).toBe(0);
  });
});

describe('ReceiptService read', () => {
  it('returns bytes to an active trip member without exposing the storage key', async () => {
    const storage = new MemoryStorage();
    storage.objects.set('private/storage-key.png', pngBytes);
    const repository = new MemoryReceiptRepository();
    repository.record = {
      id: 'receipt-1', tripId: 'trip-1', uploadedByMembershipId: 'member-1',
      storageKey: 'private/storage-key.png', contentType: 'image/png', byteSize: 8,
      checksumSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
      status: 'attached', pendingExpiresAt: null,
    };
    const { receiptService } = service({ storage, repository });

    const result = await receiptService.readReceipt('firebase-1', 'trip-1', 'receipt-1');

    expect(result).toEqual({
      bytes: pngBytes,
      contentType: 'image/png',
      byteSize: 8,
      checksumSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
    });
    expect(result).not.toHaveProperty('storageKey');
  });

  it('does not reveal whether a receipt exists to a nonmember', async () => {
    const { receiptService } = service({ membership: null });

    await expect(receiptService.readReceipt('outsider', 'trip-1', 'receipt-1'))
      .rejects.toMatchObject({ status: 403 });
  });

  it('refuses to stream an object whose bytes no longer match stored metadata', async () => {
    const storage = new MemoryStorage();
    storage.objects.set('generated.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    const repository = new MemoryReceiptRepository();
    repository.record = {
      id: 'receipt-1', tripId: 'trip-1', uploadedByMembershipId: 'member-1',
      storageKey: 'generated.png', contentType: 'image/png', byteSize: 8,
      checksumSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
      status: 'attached', pendingExpiresAt: null,
    };
    const { receiptService } = service({ storage, repository });

    await expect(receiptService.readReceipt('firebase-1', 'trip-1', 'receipt-1'))
      .rejects.toMatchObject({ status: 500, message: 'Receipt object does not match stored metadata' });
  });
});
