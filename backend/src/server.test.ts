import { describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import { createApp, createGracefulShutdown, registerShutdownHandlers, startServer } from './server';

async function checkHealth(isReady: boolean) {
  const app = createApp(() => isReady);
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
  it('reports PostgreSQL readiness from the health endpoint', async () => {
    const unavailable = await checkHealth(false);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ status: 'unavailable' });

    const available = await checkHealth(true);
    expect(available.status).toBe(200);
    expect(await available.json()).toMatchObject({ status: 'ok' });
  });

  it('does not listen when PostgreSQL initialization fails', async () => {
    let listened = false;

    await expect(startServer({
      initializeDatabase: async () => { throw new Error('DATABASE_URL is required'); },
      listen: async () => { listened = true; return { close: () => undefined }; },
    })).rejects.toThrow('DATABASE_URL is required');

    expect(listened).toBe(false);
  });

  it('initializes PostgreSQL before accepting HTTP connections', async () => {
    const events: string[] = [];

    await startServer({
      initializeDatabase: async () => { events.push('database'); },
      listen: async () => { events.push('listen'); return { close: () => undefined }; },
    });

    expect(events).toEqual(['database', 'listen']);
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
});
