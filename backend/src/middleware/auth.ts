import { NextFunction, Request, Response } from 'express';
import { auth } from '../firebase';

export interface AuthPrincipal {
  uid: string;
  email: string;
  name: string;
  emailVerified: boolean;
  provider: string;
  authTime: number;
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
  auth_time?: number;
  firebase?: { sign_in_provider?: string };
}

type VerifyToken = (token: string) => Promise<VerifiedTokenClaims>;

export interface FirebaseTokenVerifier {
  verifyIdToken(token: string, checkRevoked?: boolean): Promise<VerifiedTokenClaims>;
}

export function verifyFirebaseToken(
  verifier: FirebaseTokenVerifier,
  token: string,
): Promise<VerifiedTokenClaims> {
  return verifier.verifyIdToken(token, true);
}

function bearerToken(request: AuthRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1];
}

function principalFromClaims(claims: VerifiedTokenClaims): AuthPrincipal | undefined {
  const email = claims.email?.trim().toLowerCase();
  if (!claims.uid || !email || !Number.isSafeInteger(claims.auth_time) || claims.auth_time! <= 0) {
    return undefined;
  }

  return {
    uid: claims.uid,
    email,
    name: (claims.name?.trim() || email.split('@')[0]).slice(0, 100),
    emailVerified: claims.email_verified === true,
    provider: claims.firebase?.sign_in_provider || 'unknown',
    authTime: claims.auth_time!,
  };
}

export function createAuthenticateToken(
  verifyToken: VerifyToken = (token) => verifyFirebaseToken(auth, token),
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
      if (!principal.emailVerified) {
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
      const principal = principalFromClaims(await verifyFirebaseToken(auth, token));
      if (principal?.emailVerified) {
        request.userId = principal.uid;
        request.principal = principal;
      }
    } catch {
      // Optional authentication deliberately treats invalid credentials as anonymous.
    }
  }
  next();
}
