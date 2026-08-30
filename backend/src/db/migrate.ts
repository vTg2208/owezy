import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from '../database';

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
}

export function loadMigrations(migrationsDirectory = join(__dirname, 'migrations')): Migration[] {
  return readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort()
    .map((id) => ({ id, sql: readFileSync(join(migrationsDirectory, id), 'utf8') }));
}

export async function migrate(): Promise<void> {
  const client = await getPool().connect();
  try {
    await applyPendingMigrations(client, loadMigrations());
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate().catch((error: unknown) => {
    console.error('[DATABASE] Migration failed:', error);
    process.exitCode = 1;
  });
}
