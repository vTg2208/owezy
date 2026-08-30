import { describe, expect, it } from 'vitest';
import { getDatabaseConfig, initializeDatabase, shutdownDatabase, withTransaction } from './database';

describe('getDatabaseConfig', () => {
  it('requires DATABASE_URL', () => {
    expect(() => getDatabaseConfig({})).toThrow(/DATABASE_URL/);
  });

  it('uses the database URL without TLS when DATABASE_SSL is absent', () => {
    expect(getDatabaseConfig({ DATABASE_URL: 'postgres://user:pass@localhost:5432/trips' }))
      .toEqual({ connectionString: 'postgres://user:pass@localhost:5432/trips' });
  });

  it('enables TLS without certificate verification when DATABASE_SSL is true', () => {
    expect(getDatabaseConfig({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/trips',
      DATABASE_SSL: 'true',
    })).toEqual({
      connectionString: 'postgres://user:pass@localhost:5432/trips',
      ssl: { rejectUnauthorized: false },
    });
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

  it('ends a supplied pool during shutdown', async () => {
    let ended = false;
    const database = { end: async () => { ended = true; } };

    await shutdownDatabase(database as never);

    expect(ended).toBe(true);
  });
});
