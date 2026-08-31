import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const DEFAULT_RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_RECEIPT_PENDING_TTL_HOURS = 24;

export type SupportedReceiptContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ReceiptStorage {
  write(
    bytes: Buffer,
    contentType: SupportedReceiptContentType,
    objectId: string,
  ): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

export interface ReceiptStorageConfig {
  root?: string;
  maxBytes: number;
  pendingTtlHours: number;
}

export class ReceiptStorageDisabledError extends Error {
  constructor() {
    super('Receipt uploads are disabled because RECEIPT_STORAGE_ROOT is not configured');
    this.name = 'ReceiptStorageDisabledError';
  }
}

function positiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function getReceiptStorageConfig(
  environment: Record<string, string | undefined> = process.env,
): ReceiptStorageConfig {
  const configuredRoot = environment.RECEIPT_STORAGE_ROOT?.trim();
  return {
    ...(configuredRoot ? { root: resolve(configuredRoot) } : {}),
    maxBytes: positiveInteger(
      environment.RECEIPT_MAX_BYTES,
      'RECEIPT_MAX_BYTES',
      DEFAULT_RECEIPT_MAX_BYTES,
    ),
    pendingTtlHours: positiveInteger(
      environment.RECEIPT_PENDING_TTL_HOURS,
      'RECEIPT_PENDING_TTL_HOURS',
      DEFAULT_RECEIPT_PENDING_TTL_HOURS,
    ),
  };
}

const extensionByContentType: Record<SupportedReceiptContentType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export class LocalReceiptStorage implements ReceiptStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async write(
    bytes: Buffer,
    contentType: SupportedReceiptContentType,
    objectId: string,
  ): Promise<{ storageKey: string }> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(objectId)) {
      throw new Error('Invalid receipt object ID');
    }
    const storageKey = `${objectId}${extensionByContentType[contentType]}`;
    const objectPath = this.objectPath(storageKey);
    await mkdir(this.root, { recursive: true });
    const temporaryPath = this.objectPath(`.${storageKey}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let published = false;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, objectPath);
      published = true;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      if (!published) await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    return { storageKey };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.objectPath(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.objectPath(storageKey), { force: true });
  }

  private objectPath(storageKey: string): string {
    if (!storageKey || isAbsolute(storageKey)) {
      throw new Error('Invalid receipt storage key');
    }
    const objectPath = resolve(this.root, storageKey);
    const relativePath = relative(this.root, objectPath);
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error('Invalid receipt storage key');
    }
    return objectPath;
  }
}

export class DisabledReceiptStorage implements ReceiptStorage {
  async write(
    _bytes: Buffer,
    _contentType: SupportedReceiptContentType,
    _objectId: string,
  ): Promise<{ storageKey: string }> {
    throw new ReceiptStorageDisabledError();
  }

  async read(_storageKey: string): Promise<Buffer> {
    throw new ReceiptStorageDisabledError();
  }

  async remove(_storageKey: string): Promise<void> {
    throw new ReceiptStorageDisabledError();
  }
}
