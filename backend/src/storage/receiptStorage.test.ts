import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
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
    const storage = new LocalReceiptStorage(root);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const stored = await storage.write(bytes, 'image/png', 'receipt-1');

    expect(stored).toEqual({ storageKey: 'receipt-1.png' });
    await expect(storage.read(stored.storageKey)).resolves.toEqual(bytes);
    await expect(readFile(join(root, 'receipt-1.png'))).resolves.toEqual(bytes);
  });

  it('reuses a deterministic key and replaces corrupt bytes on restart', async () => {
    const root = await temporaryDirectory();
    const storage = new LocalReceiptStorage(root);
    const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await storage.write(expected, 'image/png', 'receipt-restart');
    await writeFile(join(root, 'receipt-restart.png'), 'corrupt');
    const restarted = await storage.write(expected, 'image/png', 'receipt-restart');

    expect(restarted.storageKey).toBe('receipt-restart.png');
    await expect(storage.read(restarted.storageKey)).resolves.toEqual(expected);
  });

  it('publishes through an exclusive same-directory temporary file and leaves no temporary artifact', async () => {
    const root = await temporaryDirectory();
    const observedNames: string[] = [];
    const watcher = watch(root, (_event, filename) => {
      if (filename) observedNames.push(filename.toString());
    });
    const storage = new LocalReceiptStorage(root);

    try {
      await storage.write(Buffer.alloc(1024 * 1024, 0x5a), 'image/png', 'atomic-write');
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      watcher.close();
    }

    expect(observedNames.some((name) => name.endsWith('.tmp'))).toBe(true);
    expect(await readdir(root)).toEqual(['atomic-write.png']);
  });

  it('cleans its exclusive temporary file when atomic publication fails', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'blocked.png'));
    const storage = new LocalReceiptStorage(root);

    await expect(storage.write(Buffer.from('bytes'), 'image/png', 'blocked')).rejects.toBeDefined();

    expect(await readdir(root)).toEqual(['blocked.png']);
  });

  it('rejects an unsafe internal object ID before creating a key', async () => {
    const root = await temporaryDirectory();
    const storage = new LocalReceiptStorage(root);

    await expect(storage.write(Buffer.from('bytes'), 'image/png', '../outside'))
      .rejects.toThrow('Invalid receipt object ID');
  });

  it('rejects traversal and absolute keys before touching files outside the root', async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, 'receipts');
    const outside = join(parent, 'outside.png');
    await writeFile(outside, 'do-not-read');
    const storage = new LocalReceiptStorage(root);

    await expect(storage.read('../outside.png')).rejects.toThrow('Invalid receipt storage key');
    await expect(storage.read(outside)).rejects.toThrow('Invalid receipt storage key');
    await expect(storage.remove('../outside.png')).rejects.toThrow('Invalid receipt storage key');
    await expect(readFile(outside, 'utf8')).resolves.toBe('do-not-read');
  });

  it('removes a stored object without exposing a filesystem path', async () => {
    const root = await temporaryDirectory();
    const storage = new LocalReceiptStorage(root);
    const { storageKey } = await storage.write(Buffer.from('jpeg'), 'image/jpeg', 'remove-me');

    await storage.remove(storageKey);

    await expect(storage.read(storageKey)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('receipt storage configuration', () => {
  it('requires complete R2 configuration when the shared driver is selected', () => {
    expect(getReceiptStorageConfig({
      RECEIPT_STORAGE_DRIVER: 'r2',
      R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      R2_BUCKET: 'receipts',
      R2_ACCESS_KEY_ID: 'access',
      R2_SECRET_ACCESS_KEY: 'secret',
    })).toMatchObject({
      driver: 'r2',
      r2: {
        endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'receipts',
        accessKeyId: 'access', secretAccessKey: 'secret',
      },
    });
    expect(() => getReceiptStorageConfig({ RECEIPT_STORAGE_DRIVER: 'r2' }))
      .toThrow(/R2_ENDPOINT/);
  });
  it('uses a disabled storage boundary when no local root is configured', async () => {
    const storage = new DisabledReceiptStorage();

    await expect(storage.write(Buffer.from('bytes'), 'image/png', 'disabled'))
      .rejects.toBeInstanceOf(ReceiptStorageDisabledError);
    await expect(storage.read('anything')).rejects.toBeInstanceOf(ReceiptStorageDisabledError);
    await expect(storage.remove('anything')).rejects.toBeInstanceOf(ReceiptStorageDisabledError);
  });

  it('parses positive limits with secure defaults', async () => {
    const root = await temporaryDirectory();

    expect(getReceiptStorageConfig({ RECEIPT_STORAGE_ROOT: root })).toEqual({
      driver: 'local',
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
    expect(() => getReceiptStorageConfig({
      RECEIPT_STORAGE_ROOT: root,
      RECEIPT_MAX_BYTES: String(20 * 1024 * 1024 + 1),
    })).toThrow('RECEIPT_MAX_BYTES must not exceed 20971520');
  });

  it('rejects single-instance local receipt storage in production', () => {
    expect(() => getReceiptStorageConfig({
      NODE_ENV: 'production',
      RECEIPT_STORAGE_DRIVER: 'local',
      RECEIPT_STORAGE_ROOT: 'receipts',
    })).toThrow(/local receipt storage is not allowed in production/i);
  });
});
