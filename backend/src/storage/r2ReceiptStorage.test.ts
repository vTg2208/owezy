import { describe, expect, it } from 'vitest';
import { R2ReceiptStorage } from './r2ReceiptStorage';

class FakeS3Client {
  readonly commands: Array<{ constructor: { name: string }; input: Record<string, unknown> }> = [];
  body = Buffer.from('stored-bytes');

  async send(command: any) {
    this.commands.push(command);
    if (command.constructor.name === 'GetObjectCommand') {
      return { Body: { transformToByteArray: async () => this.body } };
    }
    if (command.constructor.name === 'ListObjectsV2Command') {
      return { Contents: [{ Key: 'abc.png' }], NextContinuationToken: 'next' };
    }
    return {};
  }
}

describe('R2ReceiptStorage', () => {
  it('maps deterministic receipt keys to S3-compatible R2 commands', async () => {
    const client = new FakeS3Client();
    const storage = new R2ReceiptStorage(client, 'receipts');

    await expect(storage.write(Buffer.from('png'), 'image/png', 'abc')).resolves
      .toEqual({ storageKey: 'abc.png' });
    await expect(storage.read('abc.png')).resolves.toEqual(Buffer.from('stored-bytes'));
    await storage.remove('abc.png');
    await expect(storage.exists('abc.png')).resolves.toBe(true);
    await expect(storage.list(undefined, 10)).resolves.toEqual({ keys: ['abc.png'], nextCursor: 'next' });

    expect(client.commands.map((command) => ({
      name: command.constructor.name, ...command.input,
    }))).toEqual([
      { name: 'PutObjectCommand', Bucket: 'receipts', Key: 'abc.png', Body: Buffer.from('png'), ContentType: 'image/png' },
      { name: 'GetObjectCommand', Bucket: 'receipts', Key: 'abc.png' },
      { name: 'DeleteObjectCommand', Bucket: 'receipts', Key: 'abc.png' },
      { name: 'HeadObjectCommand', Bucket: 'receipts', Key: 'abc.png' },
      { name: 'ListObjectsV2Command', Bucket: 'receipts', MaxKeys: 10 },
    ]);
  });

  it('rejects unsafe object IDs and storage keys before sending commands', async () => {
    const client = new FakeS3Client();
    const storage = new R2ReceiptStorage(client, 'receipts');

    await expect(storage.write(Buffer.from('x'), 'image/png', '../escape')).rejects.toThrow(/invalid/i);
    await expect(storage.read('../escape.png')).rejects.toThrow(/invalid/i);
    await expect(storage.remove('/absolute.png')).rejects.toThrow(/invalid/i);
    expect(client.commands).toHaveLength(0);
  });
});
