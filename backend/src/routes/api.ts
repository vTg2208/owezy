import { NextFunction, RequestHandler, Response, Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { PostgresExpenseRepository } from '../repositories/expenseRepository';
import { PostgresMessageRepository } from '../repositories/messageRepository';
import { PostgresTripRepository } from '../repositories/tripRepository';
import { ServiceError } from '../services/errors';
import { ExpenseService } from '../services/expenseService';
import { MessageService } from '../services/messageService';
import { TripService } from '../services/tripService';

export interface ApiRoutesDependencies {
  tripService: Pick<TripService, 'createTrip' | 'joinTrip' | 'getTrip' | 'setLocked' | 'removeMember'>;
  expenseService: Pick<ExpenseService, 'createExpense' | 'getBalances'>;
  messageService: Pick<MessageService, 'sendMessage' | 'listMessages'>;
  authenticate: RequestHandler;
}

function defaultDependencies(): ApiRoutesDependencies {
  return {
    tripService: new TripService(new PostgresTripRepository()),
    expenseService: new ExpenseService(new PostgresExpenseRepository()),
    messageService: new MessageService(new PostgresMessageRepository()),
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
  const { tripService, expenseService, messageService, authenticate } = dependencies;

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
          amount: expense.amountMinor / 100,
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

  return router;
}

export default createApiRouter();
