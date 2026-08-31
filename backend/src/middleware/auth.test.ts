import { describe, expect, it } from 'vitest';
import type { NextFunction, Response } from 'express';
import { createAuthenticateToken, verifyFirebaseToken, type AuthRequest } from './auth';

function responseRecorder() {
  const recorded = { status: 200, body: undefined as unknown };
  const response = {
    status(code: number) { recorded.status = code; return this; },
    json(body: unknown) { recorded.body = body; return this; },
  } as unknown as Response;
  return { recorded, response };
}

describe('Firebase authentication boundary', () => {
  it('derives a trusted principal from verified token claims', async () => {
    const authenticate = createAuthenticateToken(async () => ({
      uid: 'firebase-1',
      email: 'trusted@example.com',
      name: 'Trusted Name',
      email_verified: true,
      auth_time: 1788153600,
      firebase: { sign_in_provider: 'password' },
    }));
    const request = { headers: { authorization: 'Bearer valid-token' } } as AuthRequest;
    const { recorded, response } = responseRecorder();
    let nextCalls = 0;

    await authenticate(request, response, (() => { nextCalls += 1; }) as NextFunction);

    expect(nextCalls).toBe(1);
    expect(recorded.status).toBe(200);
    expect(request.userId).toBe('firebase-1');
    expect(request.principal).toEqual({
      uid: 'firebase-1',
      email: 'trusted@example.com',
      name: 'Trusted Name',
      emailVerified: true,
      provider: 'password',
      authTime: 1788153600,
    });
  });

  it('asks Firebase to reject revoked and disabled sessions', async () => {
    const verifier = {
      async verifyIdToken(_token: string, checkRevoked?: boolean) {
        if (!checkRevoked) throw new Error('revocation check was skipped');
        return {
          uid: 'firebase-1', email: 'trusted@example.com', email_verified: true,
          auth_time: 1788153600, firebase: { sign_in_provider: 'password' },
        };
      },
    };

    await expect(verifyFirebaseToken(verifier, 'valid-token')).resolves.toMatchObject({
      uid: 'firebase-1',
    });
  });

  it('rejects an unverified password account', async () => {
    const authenticate = createAuthenticateToken(async () => ({
      uid: 'firebase-1',
      email: 'unverified@example.com',
      email_verified: false,
      auth_time: 1788153600,
      firebase: { sign_in_provider: 'password' },
    }));
    const request = { headers: { authorization: 'Bearer token' } } as AuthRequest;
    const { recorded, response } = responseRecorder();

    await authenticate(request, response, (() => undefined) as NextFunction);

    expect(recorded.status).toBe(403);
    expect(recorded.body).toEqual({ error: 'Email verification required' });
    expect(request.principal).toBeUndefined();
  });

  it('rejects an unverified email from every authentication provider', async () => {
    const authenticate = createAuthenticateToken(async () => ({
      uid: 'firebase-1',
      email: 'unverified@example.com',
      email_verified: false,
      auth_time: 1788153600,
      firebase: { sign_in_provider: 'oidc.partner' },
    }));
    const request = { headers: { authorization: 'Bearer token' } } as AuthRequest;
    const { recorded, response } = responseRecorder();

    await authenticate(request, response, (() => undefined) as NextFunction);

    expect(recorded.status).toBe(403);
    expect(recorded.body).toEqual({ error: 'Email verification required' });
    expect(request.principal).toBeUndefined();
  });

  it('bounds the trusted display name before it reaches stored records', async () => {
    const authenticate = createAuthenticateToken(async () => ({
      uid: 'firebase-1', email: 'trusted@example.com', name: 'N'.repeat(150),
      email_verified: true, auth_time: 1788153600,
      firebase: { sign_in_provider: 'password' },
    }));
    const request = { headers: { authorization: 'Bearer token' } } as AuthRequest;
    const { response } = responseRecorder();

    await authenticate(request, response, (() => undefined) as NextFunction);

    expect(request.principal?.name).toBe('N'.repeat(100));
  });

  it('rejects malformed bearer headers without verifying them', async () => {
    let verifications = 0;
    const authenticate = createAuthenticateToken(async () => {
      verifications += 1;
      throw new Error('must not run');
    });
    const request = { headers: { authorization: 'Basic token' } } as AuthRequest;
    const { recorded, response } = responseRecorder();

    await authenticate(request, response, (() => undefined) as NextFunction);

    expect(verifications).toBe(0);
    expect(recorded.status).toBe(401);
    expect(recorded.body).toEqual({ error: 'Bearer access token required' });
  });
});
