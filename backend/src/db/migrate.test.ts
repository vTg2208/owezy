import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { applyPendingMigrations, loadMigrations, migrate, type Migration } from './migrate';

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
      expect.stringContaining('pg_advisory_lock'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      'BEGIN',
      expect.stringContaining('SELECT id FROM schema_migrations'),
      migration.sql,
      'INSERT INTO schema_migrations (id) VALUES ($1)',
      'COMMIT',
      expect.stringContaining('pg_advisory_unlock'),
    ]);
    expect(queries[5].values).toEqual([migration.id]);
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
    expect(queries).toContain('ROLLBACK');
    expect(queries.at(-1)).toContain('pg_advisory_unlock');
  });

  it('serializes concurrent migration ledger checks with one advisory lock per client', async () => {
    let locked = false;
    let releaseWaiter: (() => void) | undefined;
    let criticalSections = 0;
    let maximumCriticalSections = 0;
    const client = () => ({
      async query(text: string) {
        if (text.includes('pg_advisory_unlock')) {
          criticalSections -= 1;
          locked = false;
          releaseWaiter?.();
          releaseWaiter = undefined;
          return { rows: [] };
        }
        if (text.includes('pg_advisory_lock')) {
          if (locked) await new Promise<void>((resolve) => { releaseWaiter = resolve; });
          locked = true;
          criticalSections += 1;
          maximumCriticalSections = Math.max(maximumCriticalSections, criticalSections);
        }
        if (text.startsWith('SELECT id FROM schema_migrations')) return { rows: [] };
        return { rows: [] };
      },
    });

    await Promise.all([
      applyPendingMigrations(client(), []),
      applyPendingMigrations(client(), []),
    ]);

    expect(maximumCriticalSections).toBe(1);
  });

  it('releases the client and closes the CLI pool on success and failure', async () => {
    for (const failure of [undefined, new Error('migration failed')]) {
      const events: string[] = [];
      const client = {
        async query(text: string) {
          if (failure && text.includes('CREATE TABLE IF NOT EXISTS')) throw failure;
          if (text.startsWith('SELECT id FROM schema_migrations')) return { rows: [] };
          return { rows: [] };
        },
        release() { events.push('release'); },
      };
      const pool = {
        async connect() { return client; },
        async end() { events.push('end'); },
      };

      const result = migrate(pool as never, []);
      if (failure) await expect(result).rejects.toBe(failure);
      else await expect(result).resolves.toBeUndefined();
      expect(events).toEqual(['release', 'end']);
    }
  });

  it('closes the CLI pool when acquiring a migration client fails', async () => {
    const events: string[] = [];
    const connectionFailure = new Error('database unavailable');
    const pool = {
      async connect() {
        events.push('connect');
        throw connectionFailure;
      },
      async end() { events.push('end'); },
    };

    await expect(migrate(pool as never, [])).rejects.toBe(connectionFailure);
    expect(events).toEqual(['connect', 'end']);
  });

  it('loads production hardening after the owner continuity migration', () => {
    const migrations = loadMigrations(join(__dirname, 'migrations'));

    expect(migrations.map(({ id }) => id)).toEqual([
      '001_initial.sql',
      '002_preserve_membership_history.sql',
      '003_authorized_services.sql',
      '004_receipt_storage.sql',
      '005_owner_continuity.sql',
      '006_production_hardening.sql',
    ]);
  });
});
