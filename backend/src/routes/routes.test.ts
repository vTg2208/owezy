import express, { NextFunction, Request, Response } from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiRouter } from './api';
import { createAuthRouter } from './auth';
import { AuthRequest } from '../middleware/auth';
import { ServiceError } from '../services/errors';

const servers: Server[] = [];

async function request(router: express.Router, path: string, init?: RequestInit) {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    response.status(500).json({ error: error.message });
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  return fetch(`http://127.0.0.1:${port}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
}

function authenticated(request: AuthRequest, _response: Response, next: NextFunction) {
  request.userId = 'firebase-1';
  next();
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('auth routes', () => {
  it('preserves sync and my-trips response contracts', async () => {
    const service = {
      async syncUser() {
        return {
          id: '11111111-1111-4111-8111-111111111111', firebaseUid: 'firebase-1', email: 'one@example.com',
          name: 'One', createdAt: new Date('2026-08-31T00:00:00.000Z'),
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
      method: 'POST', body: JSON.stringify({ email: 'one@example.com', name: 'One' }),
    });
    expect(await syncResponse.json()).toEqual({
      user: { id: 'firebase-1', email: 'one@example.com', name: 'One' },
    });

    const tripsResponse = await request(router, '/my-trips');
    expect(await tripsResponse.json()).toEqual({ trips: [{
      id: 'trip-1', name: 'Goa', room_code: 'ABC123', admin_id: 'owner-1', is_locked: 1,
      created_at: '2026-08-31T00:00:00.000Z', member_id: 'member-1',
    }] });
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
            expenses: [{ id: 'expense-1', tripId: 'trip-1', paidBy: 'member-1', paidByName: 'One', description: 'Meal', amountMinor: 1234, splitType: 'equal' as const, receiptUrl: 'receipt-1', createdAt: new Date('2026-08-31T00:10:00.000Z') }],
          };
        },
        async setLocked() { return { success: true as const }; },
        async removeMember() { return { success: true as const }; },
      },
      expenseService: {
        async createExpense() { return { expenseId: 'expense-1', splitType: 'equal' as const, memberCount: 1 }; },
        async getBalances() { return { balances: [], settlements: [] }; },
      },
      messageService: {
        async sendMessage() { return { messageId: 'message-1', success: true as const }; },
        async listMessages() { return { messages: [], nextCursor: undefined }; },
      },
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
      expenses: [{ id: 'expense-1', trip_id: 'trip-1', paid_by: 'member-1', paid_by_name: 'One', description: 'Meal', amount: 12.34, split_type: 'equal', receipt_url: 'receipt-1', created_at: '2026-08-31T00:10:00.000Z' }],
    });
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
});
