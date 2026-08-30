import 'dotenv/config';
import type { Server } from 'node:http';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import apiRoutes from './routes/api';
import authRoutes from './routes/auth';
import { getPool, initializeDatabase, shutdownDatabase } from './database';

const PORT = process.env.PORT || 3000;
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 1_000;

export interface CloseableServer {
  close(callback: (error?: Error) => void): unknown;
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
  query(text: string): Promise<unknown>;
}

export interface AppDependencies {
  database?: HealthDatabase;
  healthCheckTimeoutMs?: number;
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

function runtimeHealthDatabase(): HealthDatabase {
  return { query: (text) => getPool().query(text) };
}

async function checkPostgresReadiness(
  database: HealthDatabase,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      complete();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('PostgreSQL health check timed out')));
    }, timeoutMs);
    timeout.unref();

    Promise.resolve()
      .then(() => database.query('SELECT 1'))
      .then(
        () => finish(resolve),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const database = dependencies.database ?? runtimeHealthDatabase();
  const healthCheckTimeoutMs = dependencies.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));

  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  app.use('/api/auth', authRoutes);
  app.use('/api', apiRoutes);

  app.get('/health', async (req, res) => {
    try {
      await checkPostgresReadiness(database, healthCheckTimeoutMs);
    } catch {
      res.status(503).json({ status: 'unavailable', timestamp: new Date().toISOString() });
      return;
    }

    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(`[ERROR] ${err.message}`);
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
  await (dependencies.initializeDatabase ?? initializeDatabase)();
  try {
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

function closeHttpServer(server: CloseableServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function throwFailures(message: string, failures: unknown[]): never {
  if (failures.length === 1) throw failures[0];
  throw new LifecycleFailure(message, failures);
}

export function createGracefulShutdown(
  server: CloseableServer,
  closeDatabase: () => Promise<void> = shutdownDatabase,
): () => Promise<void> {
  let shutdown: Promise<void> | undefined;

  return () => {
    shutdown ??= (async () => {
      const failures: unknown[] = [];
      try {
        await closeHttpServer(server);
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
