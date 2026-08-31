import express, { NextFunction, Request, Response } from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiRouter } from './api';
import { createAuthRouter } from './auth';
import { AuthRequest } from '../middleware/auth';
import { ServiceError } from '../services/errors';
import type { QueryExecutor } from '../repositories/database';

const servers: Server[] = [];

async function request(router: express.Router, path: string, init?: RequestInit, basePath = '/api') {
  const app = express();
  app.use(express.json({ strict: false }));
  app.use(basePath, router);
  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    response.status(500).json({ error: error.message });
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  return fetch(`http://127.0.0.1:${port}${basePath}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
}

function authenticated(request: AuthRequest, _response: Response, next: NextFunction) {
  request.userId = 'firebase-1';
  request.principal = {
    uid: 'firebase-1', email: 'trusted@example.com', name: 'Trusted One',
    emailVerified: true, provider: 'password', authTime: Math.floor(Date.now() / 1000),
  };
  next();
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('auth routes', () => {
  it('preserves sync and my-trips response contracts', async () => {
    const syncCalls: unknown[][] = [];
    const service = {
      async syncUser(...values: unknown[]) {
        syncCalls.push(values);
        return {
          id: '11111111-1111-4111-8111-111111111111', firebaseUid: 'firebase-1', email: 'trusted@example.com',
          name: 'Trusted One', createdAt: new Date('2026-08-31T00:00:00.000Z'),
        };
      },
      async findUser() { return null; },
      async listUserTrips() {
        return [{
          id: 'trip-1', name: 'Goa', roomCode: 'ABC123', adminId: 'owner-1', isLocked: true,
          createdAt: new Date('2026-08-31T00:00:00.000Z'), memberId: 'member-1',
        }];
      },
      async deleteAccount() { return { success: true as const }; },
    };
    const router = createAuthRouter({ service, authenticate: authenticated });

    const syncResponse = await request(router, '/sync', {
      method: 'POST', body: JSON.stringify({ email: 'spoof@example.com', name: 'Spoofed' }),
    });
    expect(await syncResponse.json()).toEqual({
      user: { id: 'firebase-1', email: 'trusted@example.com', name: 'Trusted One' },
    });
    expect(syncCalls).toEqual([['firebase-1', 'trusted@example.com', 'Trusted One']]);

    const tripsResponse = await request(router, '/my-trips');
    expect(await tripsResponse.json()).toEqual({ trips: [{
      id: 'trip-1', name: 'Goa', room_code: 'ABC123', admin_id: 'owner-1', is_locked: 1,
      created_at: '2026-08-31T00:00:00.000Z', member_id: 'member-1',
    }] });
  });

  it('rejects account deletion from a stale authenticated session', async () => {
    let deleteCalls = 0;
    const service = {
      async syncUser() { throw new Error('not used'); },
      async findUser() { return null; },
      async listUserTrips() { return []; },
      async deleteAccount() { deleteCalls += 1; return { success: true as const }; },
    };
    const staleAuthentication = (request: AuthRequest, _response: Response, next: NextFunction) => {
      request.userId = 'firebase-1';
      request.principal = {
        uid: 'firebase-1', email: 'trusted@example.com', name: 'Trusted One',
        emailVerified: true, provider: 'password', authTime: Math.floor(Date.now() / 1000) - 301,
      };
      next();
    };

    const response = await request(
      createAuthRouter({ service, authenticate: staleAuthentication }),
      '/me',
      { method: 'DELETE' },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Recent authentication required' });
    expect(deleteCalls).toBe(0);
  });
});

describe('API routes', () => {
  function dependencies(overrides: Record<string, unknown> = {}) {
    return {
      authenticate: authenticated,
      tripService: {
        async createTrip() { return { tripId: 'trip-1', roomCode: 'ABC123', member: { id: 'owner-1', name: 'One', isAdmin: true as const } }; },
        async joinTrip() { return { tripId: 'trip-1', tripName: 'Goa', member: { id: 'member-1', name: 'One', isAdmin: false }, created: true }; },
        async getTrip() {
          return {
            trip: { id: 'trip-1', name: 'Goa', roomCode: 'ABC123', ownerMembershipId: 'owner-1', isLocked: false, createdAt: new Date('2026-08-31T00:00:00.000Z') },
            participants: [{ id: 'member-1', tripId: 'trip-1', firebaseUid: 'firebase-1', name: 'One', role: 'member' as const, status: 'active' as const, createdAt: new Date('2026-08-31T00:00:00.000Z') }],
            expenses: [{ id: 'expense-1', tripId: 'trip-1', paidBy: 'member-1', paidByName: 'One', description: 'Meal', amountMinor: 1234n, splitType: 'equal' as const, createdAt: new Date('2026-08-31T00:10:00.000Z') }],
          };
        },
        async getExpenses() { return { expenses: [], nextCursor: undefined }; },
        async setLocked() { return { success: true as const }; },
        async removeMember() { return { success: true as const }; },
      },
      expenseService: {
        async createExpense() { return { expenseId: 'expense-1', splitType: 'equal' as const, memberCount: 1 }; },
        async getBalances() { return { balances: [], settlements: [] }; },
        async correctExpense() { return { kind: 'updated' as const, expenseId: 'expense-2', expenseKey: 'expense-1', version: 2, status: 'active' as const }; },
        async voidExpense() { return { kind: 'updated' as const, expenseId: 'expense-1', expenseKey: 'expense-1', version: 1, status: 'voided' as const }; },
      },
      paymentService: {
        async create() { return { id: 'payment-1', status: 'pending' as const, amountMinor: 100n, currency: 'INR' }; },
        async confirm() { return { id: 'payment-1', status: 'confirmed' as const }; },
        async reject() { return { id: 'payment-1', status: 'rejected' as const }; },
        async cancel() { return { id: 'payment-1', status: 'cancelled' as const }; },
      },
      inviteService: {
        async create() { return { inviteId: 'invite-1', token: 'secret-token', expiresInHours: 168 }; },
        async revoke() { return { success: true as const }; },
        async accept() { return { tripId: 'trip-1', membershipId: 'member-1' }; },
      },
      financialRepository: {
        async findActiveMembershipId() { return 'member-1'; },
        async listAuditForMember() { return []; },
        async listPaymentsForMember() { return [{
          id: 'payment-1', status: 'pending' as const, payerMembershipId: 'member-1',
          payeeMembershipId: 'member-2', amountMinor: 100n, currency: 'INR',
        }]; },
      },
      idempotencyService: {
        async execute<T>(_actor: string, _operation: string, _key: string, _payload: unknown, work: (database: QueryExecutor) => Promise<{ status: number; body: T }>) {
          return { replayed: false, ...await work({ query: async () => ({ rows: [], rowCount: 0 }) }) };
        },
      },
      messageService: {
        async sendMessage() { return { messageId: 'message-1', success: true as const }; },
        async listMessages() { return { messages: [], nextCursor: undefined }; },
      },
      receiptService: {
        async uploadReceipt() {
          return {
            receiptId: 'receipt-1', receiptUrl: '/api/trips/trip-1/receipts/receipt-1',
            contentType: 'image/png' as const, byteSize: 8,
            checksumSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
            status: 'pending' as const, pendingExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
          };
        },
        async readReceipt() {
          return {
            bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            contentType: 'image/png' as const, byteSize: 8,
            checksumSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
          };
        },
      },
      receiptMaxBytes: 8,
      receiptUploadsEnabled: true,
      ...overrides,
    };
  }

  it('preserves the trip details response contract and major-unit amount', async () => {
    const router = createApiRouter(dependencies());

    const response = await request(router, '/trips/trip-1');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      trip: { id: 'trip-1', name: 'Goa', room_code: 'ABC123', admin_id: 'owner-1', is_locked: 0, created_at: '2026-08-31T00:00:00.000Z' },
      participants: [{ id: 'member-1', trip_id: 'trip-1', name: 'One', is_admin: 0, created_at: '2026-08-31T00:00:00.000Z' }],
      expenses: [{ id: 'expense-1', trip_id: 'trip-1', paid_by: 'member-1', paid_by_name: 'One', description: 'Meal', amount: 12.34, split_type: 'equal', created_at: '2026-08-31T00:10:00.000Z' }],
    });
  });

  it('marks authenticated trip reads private and reports disabled receipt uploads', async () => {
    const response = await request(
      createApiRouter(dependencies({ receiptUploadsEnabled: false })),
      '/trips/trip-1',
      undefined,
      '/api/v1',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      capabilities: { receipt_uploads: false },
    });
  });

  it('creates a pending payment through the idempotent financial route', async () => {
    const router = createApiRouter(dependencies());

    const response = await request(router, '/trips/trip-1/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'payment-key-1' },
      body: JSON.stringify({ payeeMembershipId: 'member-2', amount: '1.00' }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: 'payment-1', status: 'pending', amount: '1.00', currency: 'INR',
    });
  });

  it('returns a cursor-paginated older expense page', async () => {
    const base = dependencies();
    const getExpenses = async (_uid: string, _tripId: string, cursor?: string) => {
      expect(cursor).toBe('cursor-1');
      return {
        expenses: [{
          id: 'expense-2', tripId: 'trip-1', paidBy: 'member-1', paidByName: 'One',
          description: 'Cab', amountMinor: 505n, splitType: 'equal' as const,
          currency: 'INR', createdAt: new Date('2026-08-30T00:00:00.000Z'),
        }],
        nextCursor: 'cursor-2',
      };
    };
    const response = await request(createApiRouter(dependencies({
      tripService: { ...base.tripService, getExpenses },
    })), '/trips/trip-1/expenses?cursor=cursor-1');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      expenses: [{ id: 'expense-2', amount: 5.05, currency: 'INR' }],
      next_cursor: 'cursor-2',
    });
  });

  it('lists pending payments for recipient action', async () => {
    const response = await request(createApiRouter(dependencies()), '/trips/trip-1/payments');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ payments: [{
      id: 'payment-1', status: 'pending', payer_membership_id: 'member-1',
      payee_membership_id: 'member-2', amount: '1.00', currency: 'INR',
    }] });
  });

  it('maps membership authorization failures to their service status', async () => {
    const base = dependencies();
    const router = createApiRouter(dependencies({
      tripService: { ...base.tripService, async getTrip() { throw new ServiceError(403, 'You are not a member of this trip'); } },
    }));

    const response = await request(router, '/trips/trip-1');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'You are not a member of this trip' });
  });

  it('turns a null trip body into a controlled validation error', async () => {
    const base = dependencies();
    const received: unknown[][] = [];
    const router = createApiRouter(dependencies({
      tripService: {
        ...base.tripService,
        async createTrip(...values: unknown[]) {
          received.push(values);
          throw new ServiceError(400, 'tripName and adminName are required');
        },
      },
    }));

    const response = await request(router, '/trips', { method: 'POST', body: 'null' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'tripName and adminName are required' });
    expect(received).toEqual([['firebase-1', '', '']]);
  });

  it('uploads exact raw image bytes and returns pending receipt metadata', async () => {
    let upload: { firebaseUid: string; tripId: string; contentType: string | undefined; bytes: Buffer } | undefined;
    const base = dependencies();
    const router = createApiRouter(dependencies({
      receiptService: {
        ...base.receiptService,
        async uploadReceipt(
          firebaseUid: string,
          tripId: string,
          contentType: string | undefined,
          bytes: Buffer,
        ) {
          upload = { firebaseUid, tripId, contentType, bytes };
          return base.receiptService.uploadReceipt();
        },
      },
    }));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const response = await request(router, '/trips/trip-1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: png,
    });

    expect(response.status).toBe(201);
    expect(upload).toEqual({
      firebaseUid: 'firebase-1', tripId: 'trip-1', contentType: 'image/png', bytes: png,
    });
    expect(await response.json()).toEqual({
      receipt_id: 'receipt-1',
      receipt_url: '/api/trips/trip-1/receipts/receipt-1',
      content_type: 'image/png',
      byte_size: 8,
      checksum_sha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
      status: 'pending',
      pending_expires_at: '2026-09-01T00:00:00.000Z',
    });
  });

  it('streams receipt bytes with private authenticated response headers', async () => {
    const router = createApiRouter(dependencies());

    const response = await request(router, '/trips/trip-1/receipts/receipt-1');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe('8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('maps route-scoped raw parser size failures to 413', async () => {
    const router = createApiRouter(dependencies());

    const response = await request(router, '/trips/trip-1/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.of(0),
      ]),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Receipt image exceeds the 8 byte limit' });
  });

  it('returns the receipt input validation error from expense creation', async () => {
    const base = dependencies();
    const router = createApiRouter(dependencies({
      expenseService: {
        ...base.expenseService,
        async createExpense() {
          throw new ServiceError(400, 'receiptUrl is not accepted; upload the receipt first and send receiptId');
        },
      },
    }));

    const response = await request(router, '/trips/trip-1/expenses', {
      method: 'POST',
      body: JSON.stringify({
        description: 'Meal', amount: 10, splitType: 'equal',
        splits: [{ participantId: 'member-1', amount: 10 }], receiptUrl: 'data:image/png;base64,bytes',
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'receiptUrl is not accepted; upload the receipt first and send receiptId',
    });
  });

  it('fails explicitly when an expense amount cannot fit the legacy numeric HTTP contract', async () => {
    const base = dependencies();
    const router = createApiRouter(dependencies({
      tripService: {
        ...base.tripService,
        async getTrip() {
          return {
            trip: {
              id: 'trip-1', name: 'Goa', roomCode: 'ABC123', ownerMembershipId: 'owner-1',
              isLocked: false, createdAt: new Date('2026-08-31T00:00:00.000Z'),
            },
            participants: [],
            expenses: [{
              id: 'expense-large', tripId: 'trip-1', paidBy: 'owner-1', paidByName: 'Owner',
              description: 'Large', amountMinor: 9007199254740992n, splitType: 'equal' as const,
              createdAt: new Date('2026-08-31T00:10:00.000Z'),
            }],
          };
        },
      },
    }));

    const response = await request(router, '/trips/trip-1');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Expense amount exceeds the legacy numeric HTTP range' });
  });
});
