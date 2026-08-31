import { describe, expect, it } from 'vitest';
import { PostgresFinancialRepository } from './financialRepository';

class FinancialBoundary {
  inTransaction = false;
  auditInTransaction = false;

  async query(text: string) {
    const sql = text.replace(/\s+/g, ' ').trim();
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
      return { rows: [], rowCount: 1 };
    }
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
});
