import { S3Client } from '@aws-sdk/client-s3';
import {
  DisabledReceiptStorage,
  LocalReceiptStorage,
  ReceiptStorage,
  ReceiptStorageConfig,
} from './receiptStorage';
import { R2ReceiptStorage } from './r2ReceiptStorage';

export function createReceiptStorage(config: ReceiptStorageConfig): ReceiptStorage {
  if (config.driver === 'disabled') return new DisabledReceiptStorage();
  if (config.driver === 'local') {
    if (!config.root) throw new Error('Local receipt storage root is missing');
    return new LocalReceiptStorage(config.root);
  }
  if (!config.r2) throw new Error('R2 receipt storage configuration is missing');
  return new R2ReceiptStorage(new S3Client({
    region: 'auto',
    endpoint: config.r2.endpoint,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
    },
  }), config.r2.bucket);
}
