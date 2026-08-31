import { describe, expect, it } from 'vitest';
import { InviteService, type InviteRepository } from './inviteService';

function repository(overrides: Partial<InviteRepository> = {}): InviteRepository {
  return {
    createForOwner: async () => ({ kind: 'created', inviteId: 'invite-1' }),
    revokeForOwner: async () => 'revoked',
    acceptForUser: async () => ({ kind: 'accepted', tripId: 'trip-1', membershipId: 'member-1' }),
    ...overrides,
  };
}

describe('InviteService', () => {
  it('rejects oversized invitation addresses before persistence', async () => {
    const service = new InviteService(repository());

    await expect(service.create('owner-uid', 'trip-1', {
      email: `${'a'.repeat(312)}@example.com`,
    })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an expired invitation', async () => {
    const service = new InviteService(repository({ acceptForUser: async () => ({ kind: 'expired' }) }));

    await expect(service.accept(
      { uid: 'firebase-1', email: 'guest@example.com', name: 'Guest' },
      'expired-token',
    )).rejects.toMatchObject({ status: 410 });
  });
});
