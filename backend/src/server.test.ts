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

async function requestApp(app: ReturnType<typeof createApp>, path: string, init?: RequestInit) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('server lifecycle', () => {
  it('adds security headers and a request ID', async () => {
    const response = await requestApp(createApp({
      database: { check: async () => undefined },
      requestId: () => 'request-123',
    }), '/live');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('request-123');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('sets private no-store on authenticated API responses, including auth routes', async () => {
    const response = await requestApp(createApp({
      database: { check: async () => undefined },
      authenticate: (_request, _response, next) => next(),
    }), '/api/v1/auth/me');

    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('does not copy unexpected internal error messages into structured logs', async () => {
    const errors: Array<Record<string, unknown>> = [];
    const response = await requestApp(createApp({
      database: { check: async () => undefined },
      authenticate: () => { throw new Error('connection failed: password=secret'); },
      logger: { info: () => undefined, error: (record) => errors.push(record) },
      rateLimit: { windowMs: 60_000, max: 100 },
    }), '/api/not-a-route');

    expect(response.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors)).not.toContain('password=secret');
  });

  it('separates liveness from database readiness', async () => {
    let checks = 0;
    const app = createApp({
      database: { check: async () => { checks += 1; throw new Error('offline'); } },
    });

    const live = await requestApp(app, '/live');
    const ready = await requestApp(app, '/ready');

    expect(live.status).toBe(200);
    expect(checks).toBe(1);
    expect(ready.status).toBe(503);
  });

  it('allows configured CORS origins and rejects other browser origins', async () => {
    const app = createApp({
      database: { check: async () => undefined },
      allowedOrigins: ['https://owezy.app'],
    });

    const allowed = await requestApp(app, '/live', { headers: { Origin: 'https://owezy.app' } });
    const rejected = await requestApp(app, '/live', { headers: { Origin: 'https://evil.example' } });

    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://owezy.app');
    expect(rejected.status).toBe(403);
  });

  it('rate limits repeated requests', async () => {
    const app = createApp({
      database: { check: async () => undefined },
      rateLimit: { windowMs: 60_000, max: 1 },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      expect((await fetch(`http://127.0.0.1:${port}/live`)).status).toBe(200);
      const limited = await fetch(`http://127.0.0.1:${port}/live`);
      expect(limited.status).toBe(429);
      expect(await limited.json()).toMatchObject({ error: 'Too many requests' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rate limits clients independently behind an explicitly trusted proxy', async () => {
    const app = createApp({
      database: { check: async () => undefined },
      rateLimit: { windowMs: 60_000, max: 1 },
      trustProxyHops: 1,
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const endpoint = `http://127.0.0.1:${port}/live`;
    try {
      expect((await fetch(endpoint, { headers: { 'X-Forwarded-For': '203.0.113.10' } })).status).toBe(200);
      expect((await fetch(endpoint, { headers: { 'X-Forwarded-For': '198.51.100.20' } })).status).toBe(200);
      expect((await fetch(endpoint, { headers: { 'X-Forwarded-For': '203.0.113.10' } })).status).toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('does not let a direct client spoof X-Forwarded-For to bypass the limiter', async () => {
    const app = createApp({
      database: { check: async () => undefined },
      rateLimit: { windowMs: 60_000, max: 1 },
      trustProxyHops: 0,
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const endpoint = `http://127.0.0.1:${port}/live`;
    try {
      expect((await fetch(endpoint, { headers: { 'X-Forwarded-For': '203.0.113.10' } })).status).toBe(200);
      expect((await fetch(endpoint, { headers: { 'X-Forwarded-For': '198.51.100.20' } })).status).toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rate limits authenticated API traffic independently by trusted uid', async () => {
    const app = createApp({
      database: { check: async () => undefined },
      rateLimit: { windowMs: 60_000, max: 100 },
      uidRateLimit: { windowMs: 60_000, max: 1 },
      authenticate: (request, _response, next) => {
        const uid = request.get('x-test-uid') || 'anonymous';
        Object.assign(request, { principal: { uid, email: `${uid}@example.com`, name: uid, emailVerified: true, provider: 'test' } });
        next();
      },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      expect((await fetch(`http://127.0.0.1:${port}/api/not-a-route`, { headers: { 'x-test-uid': 'one' } })).status).toBe(404);
      const limited = await fetch(`http://127.0.0.1:${port}/api/not-a-route`, { headers: { 'x-test-uid': 'one' } });
      expect(limited.status).toBe(429);
      expect((await fetch(`http://127.0.0.1:${port}/api/not-a-route`, { headers: { 'x-test-uid': 'two' } })).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('forces stalled connections closed at the shutdown deadline', async () => {
    const events: string[] = [];
    const shutdown = createGracefulShutdown({
      close: () => { events.push('close'); },
      closeAllConnections: () => { events.push('force'); },
    }, async () => { events.push('database'); }, 5);

    await shutdown();

    expect(events).toEqual(['close', 'force', 'database']);
  });

  it('returns a controlled 400 for a JSON primitive body', async () => {
    const app = createApp({ database: { check: async () => undefined } });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid JSON request body' });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('reports a current PostgreSQL query transition from ready to unavailable', async () => {
    let available = true;
    const database = {
      check: async () => {
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
    let activeChecks = 0;
    let observedTimeout = 0;
    const stalled = await checkHealth(createApp({
      database: {
        async check(timeoutMs) {
          observedTimeout = timeoutMs;
          activeChecks += 1;
          try {
            await new Promise((_, reject) => setTimeout(
              () => reject(new Error('query timeout')),
              timeoutMs,
            ));
          } finally {
            activeChecks -= 1;
          }
        },
      },
      healthCheckTimeoutMs: 20,
    }));

    expect(stalled.status).toBe(503);
    expect(await stalled.json()).toMatchObject({ status: 'unavailable' });
    expect(observedTimeout).toBe(20);
    expect(activeChecks).toBe(0);
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
    let closeDatabaseCalls = 0;

    await expect(startServer({
      initializeDatabase: async () => { throw new Error('DATABASE_URL is required'); },
      listen: async () => { listened = true; return { close: () => undefined }; },
      closeDatabase: async () => { closeDatabaseCalls += 1; },
    })).rejects.toThrow('DATABASE_URL is required');

    expect(listened).toBe(false);
    expect(closeDatabaseCalls).toBe(1);
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
