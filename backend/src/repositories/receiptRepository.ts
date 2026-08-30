import { SupportedReceiptContentType } from '../storage/receiptStorage';
import { defaultDatabase, QueryExecutor } from './database';

export interface NewPendingReceipt {
  id: string;
  tripId: string;
  uploadedByMembershipId: string;
  storageKey: string;
  contentType: SupportedReceiptContentType;
  byteSize: number;
  checksumSha256: string;
  pendingExpiresAt: Date;
}

export interface ReceiptRecord {
  id: string;
  tripId: string;
  uploadedByMembershipId: string;
  storageKey: string;
  contentType: SupportedReceiptContentType | null;
  byteSize: number | null;
  checksumSha256: string | null;
  status: 'pending' | 'attached';
  pendingExpiresAt: Date | null;
}

export interface ReceiptMetadataRepository {
  createPending(receipt: NewPendingReceipt): Promise<boolean>;
  findForTrip(receiptId: string, tripId: string): Promise<ReceiptRecord | null>;
}

function mapReceipt(row: Record<string, any>): ReceiptRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    uploadedByMembershipId: row.uploaded_by_membership_id,
    storageKey: row.storage_key,
    contentType: row.content_type ?? null,
    byteSize: row.byte_size === null || row.byte_size === undefined ? null : Number(row.byte_size),
    checksumSha256: row.checksum_sha256 ?? null,
    status: row.status,
    pendingExpiresAt: row.pending_expires_at ?? null,
  };
}

export class PostgresReceiptRepository implements ReceiptMetadataRepository {
  constructor(private readonly database: QueryExecutor = defaultDatabase()) {}

  async createPending(receipt: NewPendingReceipt): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO receipts
         (id, trip_id, uploaded_by_membership_id, storage_key, content_type,
          byte_size, checksum_sha256, status, pending_expires_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, 'pending', $8
         FROM trip_memberships m
        WHERE m.id = $3
          AND m.trip_id = $2
          AND m.status = 'active'
       RETURNING id`,
      [
        receipt.id,
        receipt.tripId,
        receipt.uploadedByMembershipId,
        receipt.storageKey,
        receipt.contentType,
        receipt.byteSize,
        receipt.checksumSha256,
        receipt.pendingExpiresAt,
      ],
    );
    return result.rowCount === 1;
  }

  async findForTrip(receiptId: string, tripId: string): Promise<ReceiptRecord | null> {
    const result = await this.database.query(
      `SELECT id,
              trip_id,
              uploaded_by_membership_id,
              storage_key,
              content_type,
              byte_size,
              checksum_sha256,
              status,
              pending_expires_at
         FROM receipts
        WHERE id = $1 AND trip_id = $2`,
      [receiptId, tripId],
    );
    return result.rows[0] ? mapReceipt(result.rows[0]) : null;
  }
}
