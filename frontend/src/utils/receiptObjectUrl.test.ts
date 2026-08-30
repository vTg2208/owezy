import { describe, expect, it, vi } from 'vitest';
import { ReceiptObjectUrlLifecycle } from './receiptObjectUrl';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('ReceiptObjectUrlLifecycle', () => {
  it('revokes a late URL immediately when a newer receipt load supersedes it', async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    const created: string[] = [];
    const revoked: string[] = [];
    const lifecycle = new ReceiptObjectUrlLifecycle({
      create(blob) {
        const url = `blob:${blob.size}:${created.length}`;
        created.push(url);
        return url;
      },
      revoke(url) { revoked.push(url); },
    });

    const firstLoad = lifecycle.load(() => first.promise);
    const secondLoad = lifecycle.load(() => second.promise);
    second.resolve(new Blob(['newest']));
    await expect(secondLoad).resolves.toBe('blob:6:0');
    first.resolve(new Blob(['stale']));

    await expect(firstLoad).resolves.toBeNull();
    expect(revoked).toEqual(['blob:5:1']);
  });

  it('aborts an in-flight request and revokes a URL that resolves after disposal', async () => {
    const pending = deferred<Blob>();
    let signal: AbortSignal | undefined;
    const revoke = vi.fn();
    const lifecycle = new ReceiptObjectUrlLifecycle({
      create: () => 'blob:late',
      revoke,
    });
    const load = lifecycle.load((requestSignal) => {
      signal = requestSignal;
      return pending.promise;
    });

    lifecycle.dispose();
    expect(signal?.aborted).toBe(true);
    pending.resolve(new Blob(['late']));

    await expect(load).resolves.toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:late');
  });

  it('revokes the active URL and aborts its controller when the viewer closes', async () => {
    const revoke = vi.fn();
    const lifecycle = new ReceiptObjectUrlLifecycle({
      create: () => 'blob:active',
      revoke,
    });
    await lifecycle.load(async () => new Blob(['receipt']));

    lifecycle.close();

    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:active');
  });
});
