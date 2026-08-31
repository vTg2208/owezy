import 'dotenv/config';
import type { Server } from 'node:http';
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import apiRoutes from './routes/api';
import authRoutes from './routes/auth';
import { getPool, initializeDatabase, shutdownDatabase } from './database';
import {
  ContextRequest,
  createAccessLogger,
  createRequestContext,
  StructuredLogger,
} from './middleware/requestContext';
import { authenticateToken, AuthRequest } from './middleware/auth';

const PORT = process.env.PORT || 3000;
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 1_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const DEFAULT_RATE_LIMIT_MAX = 300;
const DEFAULT_UID_RATE_LIMIT_MAX = 180;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface CloseableServer {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?(): void;
}

export interface ServerLifecycleDependencies {
  initializeDatabase?: () => Promise<void>;
  listen?: () => Promise<CloseableServer>;
  closeDatabase?: () => Promise<void>;
}

export interface ShutdownSignalEmitter {
  once(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  off(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

export interface HealthDatabase {
  check(timeoutMs: number): Promise<void>;
}

export interface AppDependencies {
  database?: HealthDatabase;
  healthCheckTimeoutMs?: number;
  allowedOrigins?: readonly string[];
  requestId?: () => string;
  rateLimit?: { windowMs: number; max: number };
  uidRateLimit?: { windowMs: number; max: number };
  authenticate?: RequestHandler;
  logger?: StructuredLogger;
}

export interface LifecycleLogger {
  error(...values: unknown[]): void;
}

class LifecycleFailure extends Error {
  readonly errors: readonly unknown[];

  constructor(message: string, errors: readonly unknown[]) {
    super(message);
    this.name = 'LifecycleFailure';
    this.errors = errors;
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function configuredAllowedOrigins(environment: NodeJS.ProcessEnv = process.env): string[] {
  const configured = environment.CORS_ALLOWED_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured?.length) return [...new Set(configured)];
  if (environment.NODE_ENV === 'production') {
    throw new Error('CORS_ALLOWED_ORIGINS is required in production');
  }
  return ['http://localhost:5173'];
}

function defaultLogger(): StructuredLogger {
  if (process.env.NODE_ENV === 'test') {
    return { info: () => undefined, error: () => undefined };
  }
  return {
    info: (record) => console.log(JSON.stringify(record)),
    error: (record) => console.error(JSON.stringify(record)),
  };
}

function runtimeHealthDatabase(): HealthDatabase {
  return {
    async check(timeoutMs) {
      const client = await getPool().connect();
      let released = false;
      try {
        await client.query({ text: 'SELECT 1', query_timeout: timeoutMs } as never);
      } catch (error) {
        client.release(error instanceof Error ? error : new Error(String(error)));
        released = true;
        throw error;
      } finally {
        if (!released) client.release();
      }
    },
  };
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const database = dependencies.database ?? runtimeHealthDatabase();
  const healthCheckTimeoutMs = dependencies.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
  const allowedOrigins = dependencies.allowedOrigins ?? configuredAllowedOrigins();
  const limiter = dependencies.rateLimit ?? {
    windowMs: positiveInteger(process.env.RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS'),
    max: positiveInteger(process.env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX, 'RATE_LIMIT_MAX'),
  };
  const uidLimiter = dependencies.uidRateLimit ?? {
    windowMs: positiveInteger(process.env.UID_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS, 'UID_RATE_LIMIT_WINDOW_MS'),
    max: positiveInteger(process.env.UID_RATE_LIMIT_MAX, DEFAULT_UID_RATE_LIMIT_MAX, 'UID_RATE_LIMIT_MAX'),
  };
  const logger = dependencies.logger ?? defaultLogger();

  app.disable('x-powered-by');
  app.use(createRequestContext(dependencies.requestId));
  app.use(helmet());
  app.use((request, response, next) => {
    const origin = request.get('origin');
    if (origin && !allowedOrigins.includes(origin)) {
      response.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  });
  app.use(cors({ origin: [...allowedOrigins] }));
  app.use(rateLimit({
    windowMs: limiter.windowMs,
    limit: limiter.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: 'Too many requests' }),
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));
  app.use(createAccessLogger(logger));
  app.use('/api', dependencies.authenticate ?? authenticateToken, rateLimit({
    windowMs: uidLimiter.windowMs,
    limit: uidLimiter.max,
    keyGenerator: (request) => (request as AuthRequest).principal?.uid || 'missing-principal',
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: 'Too many requests for this account' }),
  }));

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1', apiRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api', apiRoutes);

  app.get('/live', (_request, response) => {
    response.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const readiness = async (_request: Request, response: Response) => {
    try {
      await database.check(healthCheckTimeoutMs);
    } catch {
      response.status(503).json({ status: 'unavailable', timestamp: new Date().toISOString() });
      return;
    }

    response.json({ status: 'ok', timestamp: new Date().toISOString() });
  };
  app.get('/ready', readiness);
  app.get('/health', readiness);

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: Error, request: ContextRequest, res: Response, _next: NextFunction) => {
    if (
      typeof err === 'object'
      && err !== null
      && 'type' in err
      && err.type === 'entity.parse.failed'
    ) {
      res.status(400).json({ error: 'Invalid JSON request body' });
      return;
    }
    logger.error({ event: 'request_error', requestId: request.requestId, message: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

const app = createApp();

function listen(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`[SERVER] Server running on http://localhost:${PORT}`);
      console.log(`API endpoints: http://localhost:${PORT}/api`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

export async function startServer(
  dependencies: ServerLifecycleDependencies = {},
): Promise<CloseableServer> {
  try {
    await (dependencies.initializeDatabase ?? initializeDatabase)();
    return await (dependencies.listen ?? listen)();
  } catch (error) {
    const failures: unknown[] = [error];
    try {
      await (dependencies.closeDatabase ?? shutdownDatabase)();
    } catch (closeError) {
      failures.push(closeError);
    }
    throwFailures('Server startup failed', failures);
  }
}

function closeHttpServer(server: CloseableServer, deadlineMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let completed = false;
    const complete = (error?: Error) => {
      if (completed) return;
      completed = true;
      clearTimeout(deadline);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const deadline = setTimeout(() => {
      try {
        server.closeAllConnections?.();
        complete();
      } catch (error) {
        complete(error instanceof Error ? error : new Error(String(error)));
      }
    }, deadlineMs);
    try {
      server.close(complete);
    } catch (error) {
      complete(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function throwFailures(message: string, failures: unknown[]): never {
  if (failures.length === 1) throw failures[0];
  throw new LifecycleFailure(message, failures);
}

export function createGracefulShutdown(
  server: CloseableServer,
  closeDatabase: () => Promise<void> = shutdownDatabase,
  deadlineMs = positiveInteger(process.env.SHUTDOWN_TIMEOUT_MS, DEFAULT_SHUTDOWN_TIMEOUT_MS, 'SHUTDOWN_TIMEOUT_MS'),
): () => Promise<void> {
  let shutdown: Promise<void> | undefined;

  return () => {
    shutdown ??= (async () => {
      const failures: unknown[] = [];
      try {
        await closeHttpServer(server, deadlineMs);
      } catch (error) {
        failures.push(error);
      }
      try {
        await closeDatabase();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) throwFailures('Graceful shutdown failed', failures);
    })();
    return shutdown;
  };
}

export function registerShutdownHandlers(
  server: CloseableServer,
  closeDatabase: () => Promise<void> = shutdownDatabase,
  signalEmitter: ShutdownSignalEmitter = process,
  logger: LifecycleLogger = console,
): () => void {
  const shutdown = createGracefulShutdown(server, closeDatabase);
  const onSignal = () => {
    void shutdown().catch((error: unknown) => {
      logger.error('[SERVER] Graceful shutdown failed:', error);
    });
  };

  signalEmitter.once('SIGTERM', onSignal);
  signalEmitter.once('SIGINT', onSignal);

  return () => {
    signalEmitter.off('SIGTERM', onSignal);
    signalEmitter.off('SIGINT', onSignal);
  };
}

if (require.main === module) {
  void startServer()
    .then((server) => {
      registerShutdownHandlers(server);
    })
    .catch((error: unknown) => {
      console.error('[SERVER] Failed to start:', error);
      process.exitCode = 1;
    });
}

export default app;
