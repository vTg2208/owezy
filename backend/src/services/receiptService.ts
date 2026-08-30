import { createHash } from 'node:crypto';
import {
  NewPendingReceipt,
  ReceiptMetadataRepository,
} from '../repositories/receiptRepository';
import {
  ReceiptStorage,
  ReceiptStorageConfig,
  ReceiptStorageDisabledError,
  SupportedReceiptContentType,
} from '../storage/receiptStorage';
import { generateId } from '../utils/helpers';
import { ServiceError } from './errors';
import { TripRepository } from './tripService';

const supportedContentTypes = new Set<SupportedReceiptContentType>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function normalizeContentType(value: string | undefined): SupportedReceiptContentType {
  const normalized = value?.split(';', 1)[0].trim().toLowerCase();
  if (!supportedContentTypes.has(normalized as SupportedReceiptContentType)) {
    throw new ServiceError(415, 'Receipt must be a JPEG, PNG, or WebP image');
  }
  return normalized as SupportedReceiptContentType;
}

function bytesMatchContentType(bytes: Buffer, contentType: SupportedReceiptContentType): boolean {
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

export interface UploadedReceipt {
  receiptId: string;
  receiptUrl: string;
  contentType: SupportedReceiptContentType;
  byteSize: number;
  checksumSha256: string;
  status: 'pending';
  pendingExpiresAt: Date;
}

export interface ReadReceipt {
  bytes: Buffer;
  contentType: SupportedReceiptContentType;
  byteSize: number;
  checksumSha256: string;
}

export class ReceiptService {
  constructor(
    private readonly memberships: Pick<TripRepository, 'findActiveMembership'>,
    private readonly receipts: ReceiptMetadataRepository,
    private readonly storage: ReceiptStorage,
    private readonly config: Pick<ReceiptStorageConfig, 'maxBytes' | 'pendingTtlHours'>,
    private readonly createId: () => string = generateId,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async uploadReceipt(
    firebaseUid: string,
    tripId: string,
    contentTypeHeader: string | undefined,
    bytes: Buffer,
  ): Promise<UploadedReceipt> {
    const actor = await this.memberships.findActiveMembership(firebaseUid, tripId);
    if (!actor) throw new ServiceError(403, 'You are not a member of this trip');

    const contentType = normalizeContentType(contentTypeHeader);
    if (bytes.length === 0) throw new ServiceError(400, 'Receipt image is empty');
    if (bytes.length > this.config.maxBytes) {
      throw new ServiceError(413, `Receipt image exceeds the ${this.config.maxBytes} byte limit`);
    }
    if (!bytesMatchContentType(bytes, contentType)) {
      throw new ServiceError(415, `Receipt bytes do not match ${contentType}`);
    }

    const receiptId = this.createId();
    const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
    const pendingExpiresAt = new Date(
      this.now().getTime() + this.config.pendingTtlHours * 60 * 60 * 1000,
    );

    let storageKey: string;
    try {
      ({ storageKey } = await this.storage.write(bytes, contentType));
    } catch (error) {
      if (error instanceof ReceiptStorageDisabledError) {
        throw new ServiceError(503, error.message);
      }
      throw error;
    }

    const pending: NewPendingReceipt = {
      id: receiptId,
      tripId,
      uploadedByMembershipId: actor.id,
      storageKey,
      contentType,
      byteSize: bytes.length,
      checksumSha256,
      pendingExpiresAt,
    };

    try {
      if (!await this.receipts.createPending(pending)) {
        throw new ServiceError(403, 'You are not a member of this trip');
      }
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }

    return {
      receiptId,
      receiptUrl: `/api/trips/${encodeURIComponent(tripId)}/receipts/${encodeURIComponent(receiptId)}`,
      contentType,
      byteSize: bytes.length,
      checksumSha256,
      status: 'pending',
      pendingExpiresAt,
    };
  }

  async readReceipt(firebaseUid: string, tripId: string, receiptId: string): Promise<ReadReceipt> {
    const actor = await this.memberships.findActiveMembership(firebaseUid, tripId);
    if (!actor) throw new ServiceError(403, 'You are not a member of this trip');

    const receipt = await this.receipts.findForTrip(receiptId, tripId);
    if (!receipt) throw new ServiceError(404, 'Receipt not found');
    if (!receipt.contentType || receipt.byteSize === null || !receipt.checksumSha256) {
      throw new ServiceError(500, 'Receipt metadata is incomplete');
    }

    try {
      const bytes = await this.storage.read(receipt.storageKey);
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== receipt.byteSize || checksum !== receipt.checksumSha256) {
        throw new ServiceError(500, 'Receipt object does not match stored metadata');
      }
      return {
        bytes,
        contentType: receipt.contentType,
        byteSize: receipt.byteSize,
        checksumSha256: receipt.checksumSha256,
      };
    } catch (error) {
      if (error instanceof ReceiptStorageDisabledError) {
        throw new ServiceError(503, error.message);
      }
      throw error;
    }
  }
}
