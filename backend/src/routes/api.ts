import express, { NextFunction, RequestHandler, Response, Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { PostgresExpenseRepository } from '../repositories/expenseRepository';
import { PostgresFinancialRepository } from '../repositories/financialRepository';
import { PostgresMessageRepository } from '../repositories/messageRepository';
import { PostgresReceiptRepository } from '../repositories/receiptRepository';
import { PostgresTripRepository } from '../repositories/tripRepository';
import { ServiceError } from '../services/errors';
import { ExpenseService, minorToResponseAmount } from '../services/expenseService';
import { IdempotencyService } from '../services/idempotencyService';
import { InviteService } from '../services/inviteService';
import { MessageService } from '../services/messageService';
import { ReceiptService } from '../services/receiptService';
import { TripService, TripExpenseSummary } from '../services/tripService';
import { PaymentService, PaymentRecord } from '../services/paymentService';
import { minorToMajor } from '../domain/money';
import type { QueryExecutor } from '../repositories/database';
import {
  getReceiptStorageConfig,
} from '../storage/receiptStorage';
import { createReceiptStorage } from '../storage/createReceiptStorage';

export interface ApiRoutesDependencies {
  tripService: Pick<TripService, 'createTrip' | 'joinTrip' | 'getTrip' | 'getExpenses' | 'setLocked' | 'removeMember'>;
  expenseService: Pick<ExpenseService, 'createExpense' | 'getBalances' | 'correctExpense' | 'voidExpense'>;
  paymentService: Pick<PaymentService, 'create' | 'confirm' | 'reject' | 'cancel'>;
  inviteService: Pick<InviteService, 'create' | 'revoke' | 'accept'>;
  financialRepository: Pick<PostgresFinancialRepository, 'findActiveMembershipId' | 'listAuditForMember' | 'listPaymentsForMember'>;
  idempotencyService: Pick<IdempotencyService, 'execute'>;
  messageService: Pick<MessageService, 'sendMessage' | 'listMessages'>;
  receiptService: Pick<ReceiptService, 'uploadReceipt' | 'readReceipt'>;
  receiptMaxBytes: number;
  receiptUploadsEnabled: boolean;
  authenticate: RequestHandler;
}

function defaultDependencies(): ApiRoutesDependencies {
  const tripRepository = new PostgresTripRepository();
  const expenseRepository = new PostgresExpenseRepository();
  const financialRepository = new PostgresFinancialRepository();
  const receiptConfig = getReceiptStorageConfig();
  const receiptStorage = createReceiptStorage(receiptConfig);
  return {
    tripService: new TripService(tripRepository),
    expenseService: new ExpenseService(expenseRepository),
    paymentService: new PaymentService(financialRepository),
    inviteService: new InviteService(financialRepository),
    financialRepository,
    idempotencyService: new IdempotencyService(),
    messageService: new MessageService(new PostgresMessageRepository()),
    receiptService: new ReceiptService(
      tripRepository,
      new PostgresReceiptRepository(),
      receiptStorage,
      receiptConfig,
    ),
    receiptMaxBytes: receiptConfig.maxBytes,
    receiptUploadsEnabled: receiptConfig.driver !== 'disabled',
    authenticate: authenticateToken,
  };
}

function paymentResponse(payment: PaymentRecord) {
  return {
    id: payment.id,
    status: payment.status,
    ...(payment.payerMembershipId ? { payer_membership_id: payment.payerMembershipId } : {}),
    ...(payment.payeeMembershipId ? { payee_membership_id: payment.payeeMembershipId } : {}),
    ...(payment.amountMinor !== undefined ? { amount: minorToMajor(payment.amountMinor) } : {}),
    ...(payment.currency ? { currency: payment.currency } : {}),
    ...(payment.note ? { note: payment.note } : {}),
  };
}

function expenseResponse(expense: TripExpenseSummary, fallbackCurrency: string, versioned: boolean) {
  return {
    id: expense.id,
    trip_id: expense.tripId,
    paid_by: expense.paidBy,
    paid_by_name: expense.paidByName,
    description: expense.description,
    amount: minorToResponseAmount(expense.amountMinor),
    split_type: expense.splitType,
    receipt_url: expense.receiptUrl,
    created_at: expense.createdAt,
    ...(versioned ? {
      expense_key: expense.expenseKey ?? expense.id,
      version: expense.version ?? 1,
      status: expense.status ?? 'active',
      currency: expense.currency ?? fallbackCurrency,
    } : {}),
  };
}

function handleError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof ServiceError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
}

export function createApiRouter(dependencies: ApiRoutesDependencies = defaultDependencies()): Router {
  const router = Router();
  const {
    tripService,
    expenseService,
    paymentService,
    inviteService,
    financialRepository,
    idempotencyService,
    messageService,
    receiptService,
    receiptMaxBytes,
    receiptUploadsEnabled,
    authenticate,
  } = dependencies;
  const receiptBody = express.raw({ type: () => true, limit: receiptMaxBytes });

  router.use((request, response, next) => {
    if (request.method === 'GET') response.set('Cache-Control', 'private, no-store');
    next();
  });

  const idempotentTripMutation = async <T>(
    request: AuthRequest,
    operation: string,
    payload: unknown,
    work: (database: QueryExecutor) => Promise<{ status: number; body: T }>,
  ) => {
    const actorId = await financialRepository.findActiveMembershipId(
      request.userId!, request.params.tripId,
    );
    if (!actorId) throw new ServiceError(403, 'You are not a member of this trip');
    const key = request.get('idempotency-key') ?? '';
    return idempotencyService.execute(actorId, operation, key, payload, work);
  };

  router.post('/trips', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      const { tripName, adminName } = body;
      response.status(201).json(await tripService.createTrip(request.userId!, tripName ?? '', adminName ?? ''));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/trips/join', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const joinBody = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body
        : {};
      const { roomCode, memberName } = joinBody;
      const result = await tripService.joinTrip(request.userId!, roomCode ?? '', memberName ?? '');
      const { created, ...body } = result;
      response.status(created ? 201 : 200).json(body);
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/trips/:tripId', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const details = await tripService.getTrip(request.userId!, request.params.tripId);
      const versioned = request.baseUrl.endsWith('/v1');
      const snapshot = {
        trip: {
          id: details.trip.id,
          name: details.trip.name,
          room_code: details.trip.roomCode,
          admin_id: details.trip.ownerMembershipId,
          is_locked: details.trip.isLocked ? 1 : 0,
          created_at: details.trip.createdAt,
          ...(versioned ? { currency: details.trip.currency ?? 'INR' } : {}),
        },
        participants: details.participants.map((membership) => ({
          id: membership.id,
          trip_id: membership.tripId,
          name: membership.name,
          is_admin: membership.role === 'owner' ? 1 : 0,
          created_at: membership.createdAt,
        })),
        expenses: details.expenses.map((expense) => expenseResponse(
          expense, details.trip.currency ?? 'INR', versioned,
        )),
        ...(versioned && details.expenseNextCursor ? { expense_next_cursor: details.expenseNextCursor } : {}),
      };
      if (!versioned) {
        response.json(snapshot);
        return;
      }
      const balanceReport = await expenseService.getBalances(request.userId!, request.params.tripId);
      response.json({
        ...snapshot,
        capabilities: { receipt_uploads: receiptUploadsEnabled },
        current_member_id: details.currentMembershipId
          ?? details.participants.find((member) => member.firebaseUid === request.userId)?.id,
        ...balanceReport,
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/trips/:tripId/expenses', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const page = await tripService.getExpenses(
        request.userId!, request.params.tripId,
        typeof request.query.cursor === 'string' ? request.query.cursor : undefined,
      );
      response.json({
        expenses: page.expenses.map((expense) => expenseResponse(expense, expense.currency ?? 'INR', true)),
        ...(page.nextCursor ? { next_cursor: page.nextCursor } : {}),
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/trips/:tripId/expenses', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      if (request.baseUrl.endsWith('/v1')) {
        const result = await idempotentTripMutation(
          request,
          'expense.create',
          request.body,
          async (database) => ({
            status: 201,
            body: await expenseService.createExpense(
              request.userId!, request.params.tripId, request.body, database,
            ),
          }),
        );
        response.set('Idempotency-Replayed', String(result.replayed)).status(result.status).json(result.body);
        return;
      }
      response.status(201).json(await expenseService.createExpense(
        request.userId!, request.params.tripId, request.body,
      ));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/trips/:tripId/expenses/:expenseId/correct', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const { expectedVersion, ...input } = request.body ?? {};
      const result = await idempotentTripMutation(
        request,
        'expense.correct',
        request.body,
        async (database) => ({
          status: 200,
          body: await expenseService.correctExpense(
            request.userId!, request.params.tripId, request.params.expenseId,
            expectedVersion, input, database,
          ),
        }),
      );
      response.set('Idempotency-Replayed', String(result.replayed)).status(result.status).json(result.body);
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/trips/:tripId/expenses/:expenseId/void', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const result = await idempotentTripMutation(
        request,
        'expense.void',
        request.body,
        async (database) => ({
          status: 200,
          body: await expenseService.voidExpense(
            request.userId!, request.params.tripId, request.params.expenseId,
            request.body?.expectedVersion, database,
          ),
        }),
      );
      response.set('Idempotency-Replayed', String(result.replayed)).status(result.status).json(result.body);
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/trips/:tripId/payments', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const result = await idempotentTripMutation(
        request,
        'payment.create',
        request.body,
        async (database) => ({
          status: 201,
          body: paymentResponse(await paymentService.create(
            request.userId!, request.params.tripId, request.body, database,
          )),
        }),
      );
      response.set('Idempotency-Replayed', String(result.replayed)).status(result.status).json(result.body);
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/trips/:tripId/payments', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const payments = await financialRepository.listPaymentsForMember(
        request.userId!, request.params.tripId,
      );
      if (!payments) throw new ServiceError(403, 'You are not a member of this trip');
      response.json({ payments: payments.map(paymentResponse) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  for (const [action, operation] of [
    ['confirm', 'payment.confirm'],
    ['reject', 'payment.reject'],
    ['cancel', 'payment.cancel'],
  ] as const) {
    router.post(`/trips/:tripId/payments/:paymentId/${action}`, authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
      try {
        const result = await idempotentTripMutation(
          request,
          operation,
          request.body ?? {},
          async (database) => ({
            status: 200,
            body: paymentResponse(await paymentService[action](
              request.userId!, request.params.tripId, request.params.paymentId, database,
            )),
          }),
        );
        response.set('Idempotency-Replayed', String(result.replayed)).status(result.status).json(result.body);
      } catch (error) {
        handleError(error, response, next);
      }
    });
  }

  router.post('/trips/:tripId/invites', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const result = await idempotentTripMutation(
        request,
        'invite.create',
        request.body,
        async (database) => ({
          status: 201,
          body: await inviteService.create(request.userId!, request.params.tripId, request.body, database),
        }),
      );
      response.set('Idempotency-Replayed', String(result.replayed)).status(result.status).json(result.body);
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.delete('/trips/:tripId/invites/:inviteId', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const result = await idempotentTripMutation(
        request,
        'invite.revoke',
        { inviteId: request.params.inviteId },
        async (database) => ({
          status: 200,
          body: await inviteService.revoke(
            request.userId!, request.params.tripId, request.params.inviteId, database,
          ),
        }),
      );
      response.set('Idempotency-Replayed', String(result.replayed)).status(result.status).json(result.body);
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/invites/accept', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const principal = request.principal!;
      const key = request.get('idempotency-key') ?? '';
      if (!key.trim() || key.length > 128) {
        throw new ServiceError(400, 'Idempotency-Key is required and must be at most 128 characters');
      }
      const accepted = await inviteService.accept(
        { uid: principal.uid, email: principal.email, name: principal.name },
        request.body?.token,
      );
      const result = await idempotencyService.execute(
        accepted.membershipId,
        'invite.accept',
        key,
        { token: request.body?.token },
        async () => ({ status: 200, body: accepted }),
      );
      response.set('Idempotency-Replayed', String(result.replayed)).status(result.status).json(result.body);
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/trips/:tripId/audit', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const events = await financialRepository.listAuditForMember(
        request.userId!, request.params.tripId, Number(request.query.limit ?? 100),
      );
      if (!events) throw new ServiceError(403, 'You are not a member of this trip');
      response.json({ events: events.map((event) => ({
        id: event.id,
        actor_membership_id: event.actorMembershipId,
        action: event.action,
        entity_type: event.entityType,
        entity_id: event.entityId,
        metadata: event.metadata,
        created_at: event.createdAt,
      })) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post(
    '/trips/:tripId/receipts',
    authenticate,
    receiptBody,
    async (request: AuthRequest, response: Response, next: NextFunction) => {
      try {
        const receipt = await receiptService.uploadReceipt(
          request.userId!,
          request.params.tripId,
          request.header('content-type'),
          Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
        );
        response.status(201).json({
          receipt_id: receipt.receiptId,
          receipt_url: receipt.receiptUrl,
          content_type: receipt.contentType,
          byte_size: receipt.byteSize,
          checksum_sha256: receipt.checksumSha256,
          status: receipt.status,
          pending_expires_at: receipt.pendingExpiresAt,
        });
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  router.get(
    '/trips/:tripId/receipts/:receiptId',
    authenticate,
    async (request: AuthRequest, response: Response, next: NextFunction) => {
      try {
        const receipt = await receiptService.readReceipt(
          request.userId!,
          request.params.tripId,
          request.params.receiptId,
        );
        response.status(200);
        response.set({
          'Cache-Control': 'private, no-store',
          'Content-Length': String(receipt.byteSize),
          'Content-Type': receipt.contentType,
          'X-Content-Type-Options': 'nosniff',
          'X-Receipt-SHA256': receipt.checksumSha256,
        });
        response.end(receipt.bytes);
      } catch (error) {
        handleError(error, response, next);
      }
    },
  );

  router.get('/trips/:tripId/balances', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      response.json(await expenseService.getBalances(request.userId!, request.params.tripId));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/trips/:tripId/lock', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      response.json(await tripService.setLocked(request.userId!, request.params.tripId, true));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/trips/:tripId/unlock', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      response.json(await tripService.setLocked(request.userId!, request.params.tripId, false));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.delete('/trips/:tripId/members/:memberId', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      response.json(await tripService.removeMember(
        request.userId!,
        request.params.tripId,
        request.params.memberId,
      ));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/trips/:tripId/messages', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      response.status(201).json(await messageService.sendMessage(
        request.userId!,
        request.params.tripId,
        request.body,
      ));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/trips/:tripId/messages', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const result = await messageService.listMessages(
        request.userId!,
        request.params.tripId,
        request.query,
      );
      response.json({
        messages: result.messages.map((message) => ({
          id: message.id,
          trip_id: message.tripId,
          member_id: message.membershipId,
          member_name: message.memberName,
          message: message.message,
          created_at: message.createdAt,
        })),
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.use((error: unknown, _request: AuthRequest, response: Response, next: NextFunction) => {
    if (
      typeof error === 'object'
      && error !== null
      && 'type' in error
      && error.type === 'entity.too.large'
    ) {
      response.status(413).json({ error: `Receipt image exceeds the ${receiptMaxBytes} byte limit` });
      return;
    }
    next(error);
  });

  return router;
}

export default createApiRouter();
