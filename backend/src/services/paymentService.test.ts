import { describe, expect, it } from 'vitest';
import { PaymentService, type PaymentRepository } from './paymentService';

function repository(overrides: Partial<PaymentRepository> = {}): PaymentRepository {
  return {
    createForActor: async () => ({ kind: 'created', payment: { id: 'payment-1', status: 'pending' } }),
    transitionForActor: async () => ({ kind: 'updated', payment: { id: 'payment-1', status: 'confirmed' } }),
    ...overrides,
  };
}

describe('PaymentService', () => {
  it('does not allow the payer to confirm their own payment', async () => {
    const service = new PaymentService(repository({
      transitionForActor: async () => ({ kind: 'forbidden' }),
    }));

    await expect(service.confirm('payer-uid', 'trip-1', 'payment-1'))
      .rejects.toMatchObject({ status: 403 });
  });

  it('reports a conflict when a payment is already terminal', async () => {
    const service = new PaymentService(repository({
      transitionForActor: async () => ({ kind: 'conflict' }),
    }));

    await expect(service.confirm('payee-uid', 'trip-1', 'payment-1'))
      .rejects.toMatchObject({ status: 409 });
  });
});
