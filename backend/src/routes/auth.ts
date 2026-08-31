import { NextFunction, RequestHandler, Response, Router } from 'express';
import { auth } from '../firebase';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { PostgresAccountRepository } from '../repositories/accountRepository';
import { AccountService } from '../services/accountService';
import { ServiceError } from '../services/errors';

export interface AuthRoutesDependencies {
  service: Pick<AccountService, 'syncUser' | 'findUser' | 'listUserTrips' | 'deleteAccount'>;
  authenticate: RequestHandler;
}

const MAX_SENSITIVE_AUTH_AGE_SECONDS = 5 * 60;

function hasRecentAuthentication(authTime: number, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const age = nowSeconds - authTime;
  return Number.isSafeInteger(authTime) && age >= 0 && age <= MAX_SENSITIVE_AUTH_AGE_SECONDS;
}

function defaultDependencies(): AuthRoutesDependencies {
  return {
    service: new AccountService(new PostgresAccountRepository(), auth),
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

export function createAuthRouter(dependencies: AuthRoutesDependencies = defaultDependencies()): Router {
  const router = Router();
  const { service, authenticate } = dependencies;

  router.post('/sync', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const principal = request.principal;
      if (!principal) {
        response.status(401).json({ error: 'Authenticated principal required' });
        return;
      }
      const user = await service.syncUser(principal.uid, principal.email, principal.name);
      response.json({ user: { id: user.firebaseUid, email: user.email, name: user.name } });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/me', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const user = await service.findUser(request.userId!);
      if (!user) {
        response.status(404).json({ error: 'User not found' });
        return;
      }
      response.json({
        user: {
          id: user.firebaseUid,
          email: user.email,
          name: user.name,
          created_at: user.createdAt,
        },
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/my-trips', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      const trips = await service.listUserTrips(request.userId!);
      response.json({
        trips: trips.map((trip) => ({
          id: trip.id,
          name: trip.name,
          room_code: trip.roomCode,
          admin_id: trip.adminId,
          is_locked: trip.isLocked ? 1 : 0,
          created_at: trip.createdAt,
          member_id: trip.memberId,
        })),
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.delete('/me', authenticate, async (request: AuthRequest, response: Response, next: NextFunction) => {
    try {
      if (!request.principal || !hasRecentAuthentication(request.principal.authTime)) {
        response.status(403).json({ error: 'Recent authentication required' });
        return;
      }
      response.json(await service.deleteAccount(request.userId!));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  return router;
}

export default createAuthRouter();
