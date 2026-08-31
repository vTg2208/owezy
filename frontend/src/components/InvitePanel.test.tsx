import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InvitePanel from './InvitePanel';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    createInvite: vi.fn(async () => ({ inviteId: 'invite-1', token: 'private/token', expiresInHours: 168 })),
    revokeInvite: vi.fn(async () => ({ success: true })),
  },
}));

describe('InvitePanel', () => {
  beforeEach(() => {
    vi.mocked(api.createInvite).mockClear();
  });

  it('copies the invitation secret in a fragment instead of a query string', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<InvitePanel tripId="trip-1" />);

    await user.type(screen.getByLabelText('Traveller email address'), 'guest@example.com');
    await user.click(screen.getByRole('button', { name: 'Create private link' }));
    await user.click(await screen.findByRole('button', { name: 'Copy invitation link' }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/home#invite=private%2Ftoken`,
    );
  });
});
