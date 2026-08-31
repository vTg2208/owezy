import { describe, expect, it } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { Pool } from 'pg';
import { getDatabaseConfig, initializeDatabase, shutdownDatabase, withTransaction } from './database';

describe('getDatabaseConfig', () => {
  it('requires DATABASE_URL', () => {
    expect(() => getDatabaseConfig({})).toThrow(/DATABASE_URL/);
  });

  it('uses the database URL without TLS when DATABASE_SSL is absent', () => {
    expect(getDatabaseConfig({ DATABASE_URL: 'postgres://user:pass@localhost:5432/trips' }))
      .toEqual({
        connectionString: 'postgres://user:pass@localhost:5432/trips',
        connectionTimeoutMillis: 5_000,
        query_timeout: 10_000,
        statement_timeout: 10_000,
      });
  });

  it('authenticates TLS servers and expands escaped newlines in an optional trusted CA', () => {
    expect(getDatabaseConfig({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/trips',
      DATABASE_SSL: 'true',
      DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\\ntrusted-ca\\n-----END CERTIFICATE-----',
      DATABASE_CONNECTION_TIMEOUT_MS: '2500',
      DATABASE_QUERY_TIMEOUT_MS: '4000',
    })).toEqual({
      connectionString: 'postgres://user:pass@localhost:5432/trips',
      connectionTimeoutMillis: 2_500,
      query_timeout: 4_000,
      statement_timeout: 4_000,
      ssl: {
        rejectUnauthorized: true,
        ca: '-----BEGIN CERTIFICATE-----\ntrusted-ca\n-----END CERTIFICATE-----',
      },
    });
  });

  it('rejects unbounded or malformed database timeout values', () => {
    expect(() => getDatabaseConfig({
      DATABASE_URL: 'postgres://localhost/trips', DATABASE_QUERY_TIMEOUT_MS: '0',
    })).toThrow('Invalid database configuration');
    expect(() => getDatabaseConfig({
      DATABASE_URL: 'postgres://localhost/trips', DATABASE_CONNECTION_TIMEOUT_MS: 'forever',
    })).toThrow('Invalid database configuration');
  });
});

describe('withTransaction', () => {
  it('commits the callback result and releases the checked-out client', async () => {
    const queries: string[] = [];
    let released = false;
    const client = {
      query: async (query: string) => { queries.push(query); },
      release: () => { released = true; },
    };
    const transactionPool = { connect: async () => client };

    await expect(withTransaction(async () => 'saved', transactionPool as never)).resolves.toBe('saved');
    expect(queries).toEqual(['BEGIN', 'COMMIT']);
    expect(released).toBe(true);
  });

  it('rolls back and releases the client when the callback fails', async () => {
    const queries: string[] = [];
    let released = false;
    const client = {
      query: async (query: string) => { queries.push(query); },
      release: () => { released = true; },
    };
    const transactionPool = { connect: async () => client };

    await expect(withTransaction(async () => { throw new Error('write failed'); }, transactionPool as never))
      .rejects.toThrow('write failed');
    expect(queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(released).toBe(true);
  });
});

describe('database lifecycle', () => {
  it('checks PostgreSQL connectivity during initialization', async () => {
    const queries: string[] = [];
    const database = { query: async (query: string) => { queries.push(query); } };

    await initializeDatabase(database as never);

    expect(queries).toEqual(['SELECT 1']);
  });

  it('closes a supplied pool when initialization fails', async () => {
    let ended = false;
    const database = {
      query: async () => { throw new Error('connection failed'); },
      end: async () => { ended = true; },
    };

    await expect(initializeDatabase(database as never)).rejects.toThrow('connection failed');
    expect(ended).toBe(true);
  });

  it('bounds and cleans up a connection to a server that never completes the PostgreSQL handshake', async () => {
    const sockets = new Set<Socket>();
    const blackhole = createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
    const address = blackhole.address();
    if (!address || typeof address === 'string') throw new Error('Blackhole server has no TCP address');
    const database = new Pool(getDatabaseConfig({
      DATABASE_URL: `postgres://user:pass@127.0.0.1:${address.port}/trips`,
      DATABASE_CONNECTION_TIMEOUT_MS: '30',
      DATABASE_QUERY_TIMEOUT_MS: '30',
    }));
    const startedAt = Date.now();

    try {
      await expect(initializeDatabase(database)).rejects.toThrow();
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(database.ended).toBe(true);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        blackhole.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('ends a supplied pool during shutdown', async () => {
    let ended = false;
    const database = { end: async () => { ended = true; } };

    await shutdownDatabase(database as never);

    expect(ended).toBe(true);
  });
});
