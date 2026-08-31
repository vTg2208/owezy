import { Pool, PoolClient, PoolConfig } from 'pg';
import { z } from 'zod';

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['true', 'false']).optional(),
  DATABASE_SSL_CA: z.string().min(1).optional(),
  DATABASE_CONNECTION_TIMEOUT_MS: z.string().regex(/^\d+$/).optional(),
  DATABASE_QUERY_TIMEOUT_MS: z.string().regex(/^\d+$/).optional(),
});

const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
const MAX_DATABASE_TIMEOUT_MS = 120_000;

let pool: Pool | undefined;

export function getDatabaseConfig(
  environment: Record<string, string | undefined> = process.env,
): PoolConfig {
  const parsed = databaseEnvironmentSchema.safeParse(environment);

  if (!parsed.success) {
    const missingDatabaseUrl = parsed.error.issues.some((issue) => issue.path[0] === 'DATABASE_URL');
    if (missingDatabaseUrl) {
      throw new Error('DATABASE_URL is required');
    }
    throw new Error(`Invalid database configuration: ${parsed.error.message}`);
  }

  const connectionTimeoutMillis = Number(
    parsed.data.DATABASE_CONNECTION_TIMEOUT_MS ?? DEFAULT_CONNECTION_TIMEOUT_MS,
  );
  const queryTimeoutMillis = Number(
    parsed.data.DATABASE_QUERY_TIMEOUT_MS ?? DEFAULT_QUERY_TIMEOUT_MS,
  );
  if (
    !Number.isSafeInteger(connectionTimeoutMillis)
    || connectionTimeoutMillis <= 0
    || connectionTimeoutMillis > MAX_DATABASE_TIMEOUT_MS
    || !Number.isSafeInteger(queryTimeoutMillis)
    || queryTimeoutMillis <= 0
    || queryTimeoutMillis > MAX_DATABASE_TIMEOUT_MS
  ) {
    throw new Error('Invalid database configuration: timeouts must be positive integers no greater than 120000');
  }

  return {
    connectionString: parsed.data.DATABASE_URL,
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    statement_timeout: queryTimeoutMillis,
    ...(parsed.data.DATABASE_SSL === 'true' ? {
      ssl: {
        rejectUnauthorized: true,
        ...(parsed.data.DATABASE_SSL_CA
          ? { ca: parsed.data.DATABASE_SSL_CA.replace(/\\n/g, '\n') }
          : {}),
      },
    } : {}),
  };
}

export function getPool(): Pool {
  pool ??= new Pool(getDatabaseConfig());
  return pool;
}

export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  transactionPool: Pick<Pool, 'connect'> = getPool(),
): Promise<T> {
  const client = await transactionPool.connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabase(
  database: Pick<Pool, 'query' | 'end'> = getPool(),
): Promise<void> {
  try {
    await database.query('SELECT 1');
    console.log('[DATABASE] Connected to PostgreSQL');
  } catch (error) {
    try {
      await shutdownDatabase(database);
    } catch (cleanupError) {
      throw Object.assign(new Error('PostgreSQL initialization and cleanup failed'), {
        errors: [error, cleanupError],
      });
    }
    throw error;
  }
}

export async function shutdownDatabase(database: Pick<Pool, 'end'> | undefined = pool): Promise<void> {
  if (!database) return;

  await database.end();
  if (database === pool) {
    pool = undefined;
  }
}
