import { describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:http';
import { createApp, createGracefulShutdown, registerShutdownHandlers, startServer } from './server';

async function checkHealth(app: ReturnType<typeof createApp>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    return await fetch(`http://127.0.0.1:${port}/health`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('server lifecycle', () => {
  it('reports a current PostgreSQL query transition from ready to unavailable', async () => {
    let available = true;
    const database = {
      query: async () => {
        if (!available) throw new Error('connection refused: password=secret');
      },
    };

    const ready = await checkHealth(createApp({ database, healthCheckTimeoutMs: 20 }));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'ok' });

    available = false;
    const unavailable = await checkHealth(createApp({ database, healthCheckTimeoutMs: 20 }));
    expect(unavailable.status).toBe(503);
    const unavailableBody = await unavailable.json();
    expect(unavailableBody).toMatchObject({ status: 'unavailable' });
    expect(JSON.stringify(unavailableBody)).not.toContain('secret');

    const availableAgain = await checkHealth(createApp({ database, healthCheckTimeoutMs: 20 }));
    expect(availableAgain.status).toBe(503);
  });

  it('bounds a stalled PostgreSQL health query', async () => {
    const stalled = await checkHealth(createApp({
      database: { query: async () => new Promise(() => undefined) },
      healthCheckTimeoutMs: 20,
    }));

    expect(stalled.status).toBe(503);
    expect(await stalled.json()).toMatchObject({ status: 'unavailable' });
  });

  it('closes PostgreSQL and leaves no listener after HTTP listen fails', async () => {
    let closeDatabaseCalls = 0;
    const blocker = createServer().listen(0);
    await new Promise<void>((resolve) => blocker.once('listening', resolve));
    const port = (blocker.address() as AddressInfo).port;
    let failedServer: Server | undefined;

    try {
      await expect(startServer({
        initializeDatabase: async () => undefined,
        listen: () => new Promise((resolve, reject) => {
          failedServer = createServer();
          failedServer.once('error', reject);
          failedServer.listen(port, () => resolve(failedServer!));
        }),
        closeDatabase: async () => { closeDatabaseCalls += 1; },
      })).rejects.toThrow('EADDRINUSE');

      expect(closeDatabaseCalls).toBe(1);
      expect(failedServer?.listening).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('initializes PostgreSQL before accepting HTTP connections', async () => {
    const events: string[] = [];

    await startServer({
      initializeDatabase: async () => { events.push('database'); },
      listen: async () => { events.push('listen'); return { close: () => undefined }; },
    });

    expect(events).toEqual(['database', 'listen']);
  });

  it('does not listen when PostgreSQL initialization fails', async () => {
    let listened = false;

    await expect(startServer({
      initializeDatabase: async () => { throw new Error('DATABASE_URL is required'); },
      listen: async () => { listened = true; return { close: () => undefined }; },
    })).rejects.toThrow('DATABASE_URL is required');

    expect(listened).toBe(false);
  });

  it('closes the HTTP server and PostgreSQL pool once when shutdown is requested repeatedly', async () => {
    const events: string[] = [];
    const shutdown = createGracefulShutdown(
      {
        close: (callback: (error?: Error) => void) => {
          events.push('server');
          callback();
        },
      },
      async () => { events.push('database'); },
    );

    await Promise.all([shutdown(), shutdown()]);

    expect(events).toEqual(['server', 'database']);
  });

  it('closes PostgreSQL even when HTTP shutdown fails and preserves both close failures', async () => {
    let databaseCloseCalls = 0;
    const shutdown = createGracefulShutdown(
      { close: (callback: (error?: Error) => void) => callback(new Error('HTTP close failed')) },
      async () => {
        databaseCloseCalls += 1;
        throw new Error('PostgreSQL close failed');
      },
    );

    const error = await shutdown().catch((failure: unknown) => failure);

    expect(databaseCloseCalls).toBe(1);
    expect(error).toMatchObject({ name: 'LifecycleFailure' });
    expect((error as { errors: unknown[] }).errors).toEqual([
      expect.objectContaining({ message: 'HTTP close failed' }),
      expect.objectContaining({ message: 'PostgreSQL close failed' }),
    ]);
  });

  it('uses the same graceful shutdown for SIGTERM and SIGINT', async () => {
    const listeners = new Map<string, () => void>();
    const events: string[] = [];
    const signalEmitter = {
      once: (signal: string, listener: () => void) => { listeners.set(signal, listener); },
      off: (signal: string) => { listeners.delete(signal); },
    };

    registerShutdownHandlers(
      { close: (callback: (error?: Error) => void) => { events.push('server'); callback(); } },
      async () => { events.push('database'); },
      signalEmitter,
    );

    listeners.get('SIGTERM')?.();
    listeners.get('SIGINT')?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(events).toEqual(['server', 'database']);
  });

  it('logs signal shutdown failures instead of leaving an unhandled rejection', async () => {
    const listeners = new Map<string, () => void>();
    const logged: unknown[][] = [];
    const signalEmitter = {
      once: (signal: string, listener: () => void) => { listeners.set(signal, listener); },
      off: (signal: string) => { listeners.delete(signal); },
    };

    registerShutdownHandlers(
      { close: (callback: (error?: Error) => void) => callback(new Error('HTTP close failed')) },
      async () => { throw new Error('PostgreSQL close failed'); },
      signalEmitter,
      { error: (...values: unknown[]) => { logged.push(values); } },
    );

    listeners.get('SIGTERM')?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(logged).toEqual([[
      '[SERVER] Graceful shutdown failed:',
      expect.objectContaining({ name: 'LifecycleFailure' }),
    ]]);
  });

});
