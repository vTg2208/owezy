import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'firebase-token' } },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('security-sensitive API requests', () => {
  it('makes invitation revocation replay-safe with an idempotency key', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);
    const { api } = await import('./api');

    await api.revokeInvite('trip-1', 'invite-1');

    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      Authorization: 'Bearer firebase-token',
      'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });
});
