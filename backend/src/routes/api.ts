import express, { NextFunction, RequestHandler, Response, Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { PostgresExpenseRepository } from '../repositories/expenseRepository';
import { PostgresMessageRepository } from '../repositories/messageRepository';
import { PostgresReceiptRepository } from '../repositories/receiptRepository';
import { PostgresTripRepository } from '../repositories/tripRepository';
import { ServiceError } from '../services/errors';
import { ExpenseService, minorToLegacyNumber } from '../services/expenseService';
import { MessageService } from '../services/messageService';
import { ReceiptService } from '../services/receiptService';
import { TripService } from '../services/tripService';
import {
  DisabledReceiptStorage,
  getReceiptStorageConfig,
  LocalReceiptStorage,
} from '../storage/receiptStorage';

export interface ApiRoutesDependencies {
  tripService: Pick<TripService, 'createTrip' | 'joinTrip' | 'getTrip' | 'setLocked' | 'removeMember'>;
  expenseService: Pick<ExpenseService, 'createExpense' | 'getBalances'>;
  messageService: Pick<MessageService, 'sendMessage' | 'listMessages'>;
  receiptService: Pick<ReceiptService, 'uploadReceipt' | 'readReceipt'>;
  receiptMaxBytes: number;
  authenticate: RequestHandler;
}

function defaultDependencies(): ApiRoutesDependencies {
  const tripRepository = new PostgresTripRepository();
  const receiptConfig = getReceiptStorageConfig();
  const receiptStorage = receiptConfig.root
    ? new LocalReceiptStorage(receiptConfig.root)
    : new DisabledReceiptStorage();
  return {
    tripService: new TripService(tripRepository),
    expenseService: new ExpenseService(new PostgresExpenseRepository()),
    messageService: new MessageService(new PostgresMessageRepository()),
    receiptService: new ReceiptService(
      tripRepository,
      new PostgresReceiptRepository(),
      receiptStorage,
      receiptConfig,
    ),
    receiptMaxBytes: receiptConfig.maxBytes,
    authenticate: authenticateToken,
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
    messageService,
    receiptService,
    receiptMaxBytes,
    authenticate,
  } = dependencies;
  const receiptBody = express.raw({ type: () => true, limit: receiptMaxBytes });

  router.post('/trips', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const { tripName, adminName } = request.body;
      response.status(201).json(await tripService.createTrip(request.userId!, tripName ?? '', adminName ?? ''));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/trips/join', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const { roomCode, memberName } = request.body;
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
      response.json({
        trip: {
          id: details.trip.id,
          name: details.trip.name,
          room_code: details.trip.roomCode,
          admin_id: details.trip.ownerMembershipId,
          is_locked: details.trip.isLocked ? 1 : 0,
          created_at: details.trip.createdAt,
        },
        participants: details.participants.map((membership) => ({
          id: membership.id,
          trip_id: membership.tripId,
          name: membership.name,
          is_admin: membership.role === 'owner' ? 1 : 0,
          created_at: membership.createdAt,
        })),
        expenses: details.expenses.map((expense) => ({
          id: expense.id,
          trip_id: expense.tripId,
          paid_by: expense.paidBy,
          paid_by_name: expense.paidByName,
          description: expense.description,
          amount: minorToLegacyNumber(expense.amountMinor, 'Expense amount'),
          split_type: expense.splitType,
          receipt_url: expense.receiptUrl,
          created_at: expense.createdAt,
        })),
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/trips/:tripId/expenses', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      response.status(201).json(await expenseService.createExpense(
        request.userId!,
        request.params.tripId,
        request.body,
      ));
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
