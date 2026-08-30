import { Pool, PoolClient, PoolConfig } from 'pg';
import { z } from 'zod';

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['true', 'false']).optional(),
});

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

  return parsed.data.DATABASE_SSL === 'true'
    ? {
      connectionString: parsed.data.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
    : { connectionString: parsed.data.DATABASE_URL };
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

export async function initializeDatabase(database: Pick<Pool, 'query'> = getPool()): Promise<void> {
  await database.query('SELECT 1');
  console.log('[DATABASE] Connected to PostgreSQL');
}

export async function shutdownDatabase(database: Pick<Pool, 'end'> | undefined = pool): Promise<void> {
  if (!database) return;

  await database.end();
  if (database === pool) {
    pool = undefined;
  }
}
