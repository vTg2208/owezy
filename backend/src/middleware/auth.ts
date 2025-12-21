import { Request, Response, NextFunction } from 'express';
import { auth } from '../firebase';

export interface AuthRequest extends Request {
  userId?: string;
}

export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.userId = decodedToken.uid;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    // @ts-ignore
    if (error.code) console.error('Error code:', error.code);
    // @ts-ignore
    if (error.message) console.error('Error message:', error.message);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decodedToken = await auth.verifyIdToken(token);
      req.userId = decodedToken.uid;
    } catch (error) {
      // Token invalid, but we don't reject the request
    }
  }
  next();
}

// Export a dummy secret for backward compatibility if needed, though unused now
export const JWT_SECRET = 'unused';
