import { describe, expect, it, vi } from 'vitest';
import { ApiError, createRequestClient } from './api';

describe('typed API request client', () => {
  it('decodes structured failures with the server request ID', async () => {
    const client = createRequestClient({
      baseUrl: 'https://api.example/api/v1',
      getToken: async () => 'token',
      fetcher: vi.fn(async () => new Response(
        JSON.stringify({ code: 'VERSION_CONFLICT', error: 'Expense version is stale' }),
        { status: 409, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'request-1' } },
      )),
    });

    const error = await client.request('/expenses/1', { method: 'POST', json: {} })
      .catch((failure) => failure);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409, code: 'VERSION_CONFLICT', message: 'Expense version is stale', requestId: 'request-1',
    });
  });

  it('adds auth and idempotency headers and aborts at the configured timeout', async () => {
    let observed: RequestInit | undefined;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      observed = init;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    });
    const client = createRequestClient({
      baseUrl: '/api/v1', getToken: async () => 'firebase-token', fetcher, timeoutMs: 5,
    });

    await expect(client.request('/payments', {
      method: 'POST', json: { amount: '1.00' }, idempotencyKey: 'key-1',
    })).rejects.toBeDefined();
    expect(observed?.headers).toMatchObject({
      Authorization: 'Bearer firebase-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'key-1',
    });
    expect(observed?.signal?.aborted).toBe(true);
  });
});
