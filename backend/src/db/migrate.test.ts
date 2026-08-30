import { describe, expect, it } from 'vitest';
import { applyPendingMigrations, type Migration } from './migrate';

describe('applyPendingMigrations', () => {
  it('runs only unapplied migrations and records them atomically', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const migration: Migration = { id: '001_initial.sql', sql: 'CREATE TABLE trips (id text);' };
    const database = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.startsWith('SELECT id FROM schema_migrations')) {
          return { rows: [{ id: '000_prior.sql' }] };
        }
        return { rows: [] };
      },
    };

    await applyPendingMigrations(database, [migration]);

    expect(queries.map(({ text }) => text)).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      'BEGIN',
      expect.stringContaining('SELECT id FROM schema_migrations'),
      migration.sql,
      'INSERT INTO schema_migrations (id) VALUES ($1)',
      'COMMIT',
    ]);
    expect(queries[4].values).toEqual([migration.id]);
  });

  it('does not rerun an applied migration', async () => {
    const queries: string[] = [];
    const migration: Migration = { id: '001_initial.sql', sql: 'CREATE TABLE trips (id text);' };
    const database = {
      query: async (text: string) => {
        queries.push(text);
        if (text.startsWith('SELECT id FROM schema_migrations')) {
          return { rows: [{ id: migration.id }] };
        }
        return { rows: [] };
      },
    };

    await applyPendingMigrations(database, [migration]);

    expect(queries).not.toContain(migration.sql);
    expect(queries).not.toContain('INSERT INTO schema_migrations (id) VALUES ($1)');
  });

  it('applies a new ordered migration after an already-recorded initial migration', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const migrations: Migration[] = [
      { id: '001_initial.sql', sql: 'legacy initial migration' },
      { id: '002_preserve_membership_history.sql', sql: 'forward repair migration' },
    ];
    const database = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.startsWith('SELECT id FROM schema_migrations')) {
          return { rows: [{ id: '001_initial.sql' }] };
        }
        return { rows: [] };
      },
    };

    await applyPendingMigrations(database, migrations);

    expect(queries.map(({ text }) => text)).not.toContain(migrations[0].sql);
    expect(queries).toContainEqual({ text: migrations[1].sql, values: undefined });
    expect(queries).toContainEqual({
      text: 'INSERT INTO schema_migrations (id) VALUES ($1)',
      values: ['002_preserve_membership_history.sql'],
    });
  });

  it('rolls back when a migration fails', async () => {
    const queries: string[] = [];
    const migration: Migration = { id: '001_initial.sql', sql: 'BROKEN SQL' };
    const database = {
      query: async (text: string) => {
        queries.push(text);
        if (text.startsWith('SELECT id FROM schema_migrations')) return { rows: [] };
        if (text === migration.sql) throw new Error('syntax error');
        return { rows: [] };
      },
    };

    await expect(applyPendingMigrations(database, [migration])).rejects.toThrow('syntax error');
    expect(queries.at(-1)).toBe('ROLLBACK');
  });
});
