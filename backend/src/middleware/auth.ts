import { NextFunction, Request, Response } from 'express';
import { auth } from '../firebase';

export interface AuthPrincipal {
  uid: string;
  email: string;
  name: string;
  emailVerified: boolean;
  provider: string;
}

export interface AuthRequest extends Request {
  userId?: string;
  principal?: AuthPrincipal;
}

interface VerifiedTokenClaims {
  uid: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
}

type VerifyToken = (token: string) => Promise<VerifiedTokenClaims>;

function bearerToken(request: AuthRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1];
}

function principalFromClaims(claims: VerifiedTokenClaims): AuthPrincipal | undefined {
  const email = claims.email?.trim().toLowerCase();
  if (!claims.uid || !email) return undefined;

  return {
    uid: claims.uid,
    email,
    name: claims.name?.trim() || email.split('@')[0],
    emailVerified: claims.email_verified === true,
    provider: claims.firebase?.sign_in_provider || 'unknown',
  };
}

export function createAuthenticateToken(
  verifyToken: VerifyToken = (token) => auth.verifyIdToken(token),
) {
  return async (request: AuthRequest, response: Response, next: NextFunction) => {
    if (request.principal) {
      next();
      return;
    }
    const token = bearerToken(request);
    if (!token) {
      response.status(401).json({ error: 'Bearer access token required' });
      return;
    }

    try {
      const principal = principalFromClaims(await verifyToken(token));
      if (!principal) {
        response.status(403).json({ error: 'Authenticated account requires an email' });
        return;
      }
      if (principal.provider === 'password' && !principal.emailVerified) {
        response.status(403).json({ error: 'Email verification required' });
        return;
      }

      request.userId = principal.uid;
      request.principal = principal;
      next();
    } catch {
      response.status(403).json({ error: 'Invalid or expired token' });
    }
  };
}

export const authenticateToken = createAuthenticateToken();

export async function optionalAuth(request: AuthRequest, _response: Response, next: NextFunction) {
  const token = bearerToken(request);
  if (token) {
    try {
      const principal = principalFromClaims(await auth.verifyIdToken(token));
      if (principal && (principal.provider !== 'password' || principal.emailVerified)) {
        request.userId = principal.uid;
        request.principal = principal;
      }
    } catch {
      // Optional authentication deliberately treats invalid credentials as anonymous.
    }
  }
  next();
}
