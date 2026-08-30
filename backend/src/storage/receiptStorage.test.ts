import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DisabledReceiptStorage,
  LocalReceiptStorage,
  ReceiptStorageDisabledError,
  getReceiptStorageConfig,
} from './receiptStorage';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'owezy-receipts-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('LocalReceiptStorage', () => {
  it('writes and reads exact bytes under a server-generated key', async () => {
    const root = await temporaryDirectory();
    const storage = new LocalReceiptStorage(root, () => 'server-generated');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const stored = await storage.write(bytes, 'image/png');

    expect(stored).toEqual({ storageKey: 'server-generated.png' });
    await expect(storage.read(stored.storageKey)).resolves.toEqual(bytes);
    await expect(readFile(join(root, 'server-generated.png'))).resolves.toEqual(bytes);
  });

  it('rejects traversal and absolute keys before touching files outside the root', async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, 'receipts');
    const outside = join(parent, 'outside.png');
    await writeFile(outside, 'do-not-read');
    const storage = new LocalReceiptStorage(root, () => 'safe-key');

    await expect(storage.read('../outside.png')).rejects.toThrow('Invalid receipt storage key');
    await expect(storage.read(outside)).rejects.toThrow('Invalid receipt storage key');
    await expect(storage.remove('../outside.png')).rejects.toThrow('Invalid receipt storage key');
    await expect(readFile(outside, 'utf8')).resolves.toBe('do-not-read');
  });

  it('removes a stored object without exposing a filesystem path', async () => {
    const root = await temporaryDirectory();
    const storage = new LocalReceiptStorage(root, () => 'remove-me');
    const { storageKey } = await storage.write(Buffer.from('jpeg'), 'image/jpeg');

    await storage.remove(storageKey);

    await expect(storage.read(storageKey)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('receipt storage configuration', () => {
  it('uses a disabled storage boundary when no local root is configured', async () => {
    const storage = new DisabledReceiptStorage();

    await expect(storage.write(Buffer.from('bytes'), 'image/png'))
      .rejects.toBeInstanceOf(ReceiptStorageDisabledError);
    await expect(storage.read('anything')).rejects.toBeInstanceOf(ReceiptStorageDisabledError);
    await expect(storage.remove('anything')).rejects.toBeInstanceOf(ReceiptStorageDisabledError);
  });

  it('parses positive limits with secure defaults', async () => {
    const root = await temporaryDirectory();

    expect(getReceiptStorageConfig({ RECEIPT_STORAGE_ROOT: root })).toEqual({
      root,
      maxBytes: 5 * 1024 * 1024,
      pendingTtlHours: 24,
    });
    expect(getReceiptStorageConfig({
      RECEIPT_STORAGE_ROOT: root,
      RECEIPT_MAX_BYTES: '1024',
      RECEIPT_PENDING_TTL_HOURS: '6',
    })).toMatchObject({ maxBytes: 1024, pendingTtlHours: 6 });

    expect(() => getReceiptStorageConfig({
      RECEIPT_STORAGE_ROOT: root,
      RECEIPT_MAX_BYTES: '0',
    })).toThrow('RECEIPT_MAX_BYTES must be a positive integer');
  });
});
