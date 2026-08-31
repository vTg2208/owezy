import { randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const DEFAULT_RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_RECEIPT_PENDING_TTL_HOURS = 24;
const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;

export type SupportedReceiptContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ReceiptStorage {
  write(
    bytes: Buffer,
    contentType: SupportedReceiptContentType,
    objectId: string,
  ): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
  exists?(storageKey: string): Promise<boolean>;
  list?(cursor: string | undefined, limit: number): Promise<{ keys: string[]; nextCursor?: string }>;
}

export interface ReceiptStorageConfig {
  driver: 'disabled' | 'local' | 'r2';
  root?: string;
  r2?: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  maxBytes: number;
  pendingTtlHours: number;
}

export class ReceiptStorageDisabledError extends Error {
  constructor() {
    super('Receipt uploads are disabled by RECEIPT_STORAGE_DRIVER');
    this.name = 'ReceiptStorageDisabledError';
  }
}

function positiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  if (parsed > maximum) throw new Error(`${name} must not exceed ${maximum}`);
  return parsed;
}

export function getReceiptStorageConfig(
  environment: Record<string, string | undefined> = process.env,
): ReceiptStorageConfig {
  const configuredRoot = environment.RECEIPT_STORAGE_ROOT?.trim();
  const configuredDriver = environment.RECEIPT_STORAGE_DRIVER?.trim().toLowerCase();
  const driver = configuredDriver || (configuredRoot ? 'local' : 'disabled');
  if (!['disabled', 'local', 'r2'].includes(driver)) {
    throw new Error('RECEIPT_STORAGE_DRIVER must be disabled, local, or r2');
  }
  if (driver === 'local' && !configuredRoot) {
    throw new Error('RECEIPT_STORAGE_ROOT is required when RECEIPT_STORAGE_DRIVER=local');
  }
  if (driver === 'local' && environment.NODE_ENV === 'production') {
    throw new Error('Local receipt storage is not allowed in production; configure R2');
  }
  let r2: ReceiptStorageConfig['r2'];
  if (driver === 'r2') {
    const required = [
      ['R2_ENDPOINT', environment.R2_ENDPOINT?.trim()],
      ['R2_BUCKET', environment.R2_BUCKET?.trim()],
      ['R2_ACCESS_KEY_ID', environment.R2_ACCESS_KEY_ID?.trim()],
      ['R2_SECRET_ACCESS_KEY', environment.R2_SECRET_ACCESS_KEY?.trim()],
    ] as const;
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`${missing.join(', ')} required when RECEIPT_STORAGE_DRIVER=r2`);
    let endpoint: URL;
    try {
      endpoint = new URL(required[0][1]!);
    } catch {
      throw new Error('R2_ENDPOINT must be a valid HTTPS URL');
    }
    if (endpoint.protocol !== 'https:') throw new Error('R2_ENDPOINT must be a valid HTTPS URL');
    r2 = {
      endpoint: endpoint.toString().replace(/\/$/, ''),
      bucket: required[1][1]!,
      accessKeyId: required[2][1]!,
      secretAccessKey: required[3][1]!,
    };
  }
  return {
    driver: driver as ReceiptStorageConfig['driver'],
    ...(driver === 'local' && configuredRoot ? { root: resolve(configuredRoot) } : {}),
    ...(r2 ? { r2 } : {}),
    maxBytes: positiveInteger(
      environment.RECEIPT_MAX_BYTES,
      'RECEIPT_MAX_BYTES',
      DEFAULT_RECEIPT_MAX_BYTES,
      MAX_RECEIPT_BYTES,
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

  async exists(storageKey: string): Promise<boolean> {
    try { await access(this.objectPath(storageKey)); return true; }
    catch { return false; }
  }

  async list(cursor: string | undefined, limit: number): Promise<{ keys: string[]; nextCursor?: string }> {
    let names: string[];
    try { names = (await readdir(this.root)).filter((name) => !name.startsWith('.')).sort(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { keys: [] };
      throw error;
    }
    const remaining = cursor ? names.filter((name) => name > cursor) : names;
    const keys = remaining.slice(0, limit);
    return { keys, ...(remaining.length > keys.length ? { nextCursor: keys[keys.length - 1] } : {}) };
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
