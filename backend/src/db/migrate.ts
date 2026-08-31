import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, shutdownDatabase } from '../database';
import type { Pool, PoolClient } from 'pg';

export interface Migration {
  id: string;
  sql: string;
}

export interface MigrationDatabase {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }>;
}

export async function applyPendingMigrations(
  database: MigrationDatabase,
  migrations: readonly Migration[],
): Promise<void> {
  await database.query(`SELECT pg_advisory_lock(hashtext('owezy_schema_migrations'))`);
  try {
    await database.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await database.query('BEGIN');
    try {
      const result = await database.query('SELECT id FROM schema_migrations');
      const appliedIds = new Set(result.rows.map(({ id }) => id));

      for (const migration of migrations) {
        if (appliedIds.has(migration.id)) continue;
        await database.query(migration.sql);
        await database.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      }

      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }
  } finally {
    await database.query(`SELECT pg_advisory_unlock(hashtext('owezy_schema_migrations'))`);
  }
}

export function loadMigrations(migrationsDirectory = join(__dirname, 'migrations')): Migration[] {
  return readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort()
    .map((id) => ({ id, sql: readFileSync(join(migrationsDirectory, id), 'utf8') }));
}

export async function migrate(
  migrationPool: Pick<Pool, 'connect' | 'end'> = getPool(),
  migrations: readonly Migration[] = loadMigrations(),
): Promise<void> {
  let client: PoolClient | undefined;
  try {
    client = await migrationPool.connect();
    await applyPendingMigrations(client, migrations);
  } finally {
    try {
      client?.release();
    } finally {
      await shutdownDatabase(migrationPool);
    }
  }
}

if (require.main === module) {
  migrate().catch((error: unknown) => {
    console.error('[DATABASE] Migration failed:', error);
    process.exitCode = 1;
  });
}
