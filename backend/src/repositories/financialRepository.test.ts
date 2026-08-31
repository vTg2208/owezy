import { describe, expect, it } from 'vitest';
import { PostgresFinancialRepository } from './financialRepository';

class FinancialBoundary {
  inTransaction = false;
  auditInTransaction = false;
  auditMetadata: Array<Record<string, unknown>> = [];

  async query(text: string, values: unknown[] = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.includes('FROM trip_memberships m') && sql.includes("m.role = 'owner'")) {
      return { rows: [{ id: 'owner-member' }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO trip_invites')) {
      return { rows: [{ id: 'invite-1' }], rowCount: 1 };
    }
    if (sql.includes('FROM payments') && sql.includes('FOR UPDATE')) {
      return { rows: [{
        id: 'payment-1', status: 'pending', payer_membership_id: 'payer',
        payee_membership_id: 'payee', amount_minor: '100', currency: 'INR', actor_id: 'payee',
      }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE payments')) {
      return { rows: [{
        id: 'payment-1', status: 'confirmed', payer_membership_id: 'payer',
        payee_membership_id: 'payee', amount_minor: '100', currency: 'INR',
      }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO audit_events')) {
      this.auditInTransaction = this.inTransaction;
      this.auditMetadata.push(JSON.parse(String(values[5])));
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

class InviteAcceptanceBoundary {
  displayName = '';

  constructor(private readonly locked = false) {}

  async query(text: string, values: unknown[] = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.includes('FROM trip_invites i') && sql.includes('JOIN trips')) {
      return { rows: [{ id: 'invite-1', trip_id: 'trip-1', email: 'guest@example.com', status: 'pending', expires_at: new Date('2026-09-01T00:00:00.000Z'), is_locked: this.locked }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id FROM users')) {
      return { rows: [{ id: 'user-1' }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id, status FROM trip_memberships')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT EXISTS')) {
      return { rows: [{ conflict: true }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO trip_memberships')) {
      this.displayName = String(values[3]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE trip_invites')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO audit_events')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

describe('PostgresFinancialRepository', () => {
  it('authorizes and audits a recipient confirmation in the mutation transaction', async () => {
    const database = new FinancialBoundary();
    const repository = new PostgresFinancialRepository(database, async (work) => {
      database.inTransaction = true;
      try { return await work(database); } finally { database.inTransaction = false; }
    }, () => 'audit-1');

    const result = await repository.transitionForActor(
      'payee-uid', 'trip-1', 'payment-1', 'confirmed',
    );

    expect(result).toMatchObject({ kind: 'updated', payment: { status: 'confirmed' } });
    expect(database.auditInTransaction).toBe(true);
  });

  it('does not disclose an invitee email address in member-visible audit metadata', async () => {
    const database = new FinancialBoundary();
    const repository = new PostgresFinancialRepository(
      database,
      async (work) => work(database),
      () => 'audit-1',
    );

    await repository.createForOwner('owner-uid', 'trip-1', {
      id: 'invite-1', email: 'private@example.com', tokenHash: 'a'.repeat(64),
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(database.auditMetadata).toEqual([{
      expiresAt: '2026-09-01T00:00:00.000Z',
    }]);
  });

  it('keeps a conflict-resolved invite display name inside the stored-name limit', async () => {
    const database = new InviteAcceptanceBoundary();
    const repository = new PostgresFinancialRepository(
      database,
      async (work) => work(database),
      () => 'audit-1',
    );

    await repository.acceptForUser(
      { uid: 'guest-uid', email: 'guest@example.com', name: 'N'.repeat(100) },
      'a'.repeat(64),
      'member-1234',
    );

    expect(database.displayName).toBe(`${'N'.repeat(95)} memb`);
    expect(database.displayName).toHaveLength(100);
  });

  it('rejects a new invitation acceptance while the room is closed', async () => {
    const database = new InviteAcceptanceBoundary(true);
    const repository = new PostgresFinancialRepository(
      database,
      async (work) => work(database),
      () => 'audit-1',
    );

    const result = await repository.acceptForUser(
      { uid: 'guest-uid', email: 'guest@example.com', name: 'Guest' },
      'a'.repeat(64),
      'member-1234',
    );

    expect(result).toEqual({ kind: 'locked' });
  });
});
