import 'dotenv/config';
import type { Server } from 'node:http';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import apiRoutes from './routes/api';
import authRoutes from './routes/auth';
import { initializeDatabase, shutdownDatabase } from './database';

const PORT = process.env.PORT || 3000;
let databaseReady = false;

export interface CloseableServer {
  close(callback: (error?: Error) => void): unknown;
}

export interface ServerLifecycleDependencies {
  initializeDatabase?: () => Promise<void>;
  listen?: () => Promise<CloseableServer>;
}

export interface ShutdownSignalEmitter {
  once(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  off(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

export function createApp(isDatabaseReady: () => boolean = () => databaseReady) {
  const app = express();

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

  app.get('/health', (req, res) => {
    if (!isDatabaseReady()) {
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
  databaseReady = true;
  return (dependencies.listen ?? listen)();
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

export function createGracefulShutdown(
  server: CloseableServer,
  closeDatabase: () => Promise<void> = shutdownDatabase,
): () => Promise<void> {
  let shutdown: Promise<void> | undefined;

  return () => {
    shutdown ??= closeHttpServer(server)
      .then(async () => {
        databaseReady = false;
        await closeDatabase();
      });
    return shutdown;
  };
}

export function registerShutdownHandlers(
  server: CloseableServer,
  closeDatabase: () => Promise<void> = shutdownDatabase,
  signalEmitter: ShutdownSignalEmitter = process,
): () => void {
  const shutdown = createGracefulShutdown(server, closeDatabase);
  const onSignal = () => { void shutdown(); };

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
      console.error('[DATABASE] Failed to initialize PostgreSQL:', error);
      process.exitCode = 1;
    });
}

export default app;
