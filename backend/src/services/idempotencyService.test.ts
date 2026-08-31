import { describe, expect, it } from 'vitest';
import { IdempotencyService } from './idempotencyService';
import type { QueryExecutor } from '../repositories/database';

class IdempotencyDatabase implements QueryExecutor {
  record?: {
    actor: string; operation: string; key: string; hash: string;
    status?: number; body?: unknown; completed?: Date;
  };

  async query(text: string, values: any[] = []) {
    if (text.includes('INSERT INTO idempotency_records')) {
      if (this.record) return { rows: [], rowCount: 0 };
      this.record = { actor: values[1], operation: values[2], key: values[3], hash: values[4] };
      return { rows: [{ id: values[0] }], rowCount: 1 };
    }
    if (text.includes('FROM idempotency_records') && text.includes('FOR UPDATE')) {
      return { rows: this.record ? [{
        request_hash: this.record.hash,
        response_status: this.record.status,
        response_body: this.record.body,
        completed_at: this.record.completed,
      }] : [], rowCount: this.record ? 1 : 0 };
    }
    if (text.includes('UPDATE idempotency_records')) {
      if (!this.record) throw new Error('missing record');
      this.record.status = values[1];
      this.record.body = JSON.parse(values[2]);
      this.record.completed = new Date();
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  }
}

describe('IdempotencyService', () => {
  it('runs an identical request once and replays the stored response', async () => {
    const database = new IdempotencyDatabase();
    const service = new IdempotencyService(async (work) => work(database), () => 'idem-1');
    let calls = 0;
    const work = async () => { calls += 1; return { status: 201, body: { id: 'payment-1' } }; };

    const first = await service.execute('member-1', 'payment.create', 'same-key', { amount: '1.00' }, work);
    const replay = await service.execute('member-1', 'payment.create', 'same-key', { amount: '1.00' }, work);

    expect(first).toEqual({ replayed: false, status: 201, body: { id: 'payment-1' } });
    expect(replay).toEqual({ replayed: true, status: 201, body: { id: 'payment-1' } });
    expect(calls).toBe(1);
  });

  it('rejects reuse of a key with a different payload', async () => {
    const database = new IdempotencyDatabase();
    const service = new IdempotencyService(async (work) => work(database), () => 'idem-1');
    await service.execute('member-1', 'payment.create', 'same-key', { amount: '1.00' }, async () => ({ status: 201, body: {} }));

    await expect(service.execute(
      'member-1', 'payment.create', 'same-key', { amount: '2.00' },
      async () => ({ status: 201, body: {} }),
    )).rejects.toMatchObject({ status: 409 });
  });
});
