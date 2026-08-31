import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { ReceiptStorage, SupportedReceiptContentType } from './receiptStorage';

export interface S3CommandClient {
  send(command: unknown): Promise<any>;
}

const extensionByContentType: Record<SupportedReceiptContentType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function receiptKey(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}\.(?:jpg|png|webp)$/.test(value)) {
    throw new Error('Invalid receipt storage key');
  }
  return value;
}

export class R2ReceiptStorage implements ReceiptStorage {
  constructor(
    private readonly client: S3CommandClient,
    private readonly bucket: string,
  ) {
    if (!bucket.trim()) throw new Error('R2 bucket is required');
  }

  async write(bytes: Buffer, contentType: SupportedReceiptContentType, objectId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(objectId)) {
      throw new Error('Invalid receipt object ID');
    }
    const storageKey = `${objectId}${extensionByContentType[contentType]}`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      Body: bytes,
      ContentType: contentType,
    }));
    return { storageKey };
  }

  async read(storageKey: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: receiptKey(storageKey),
    }));
    if (!result.Body || typeof result.Body.transformToByteArray !== 'function') {
      throw new Error('R2 returned an unreadable receipt body');
    }
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async remove(storageKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: receiptKey(storageKey),
    }));
  }
}
