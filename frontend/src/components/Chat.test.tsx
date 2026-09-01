import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import Chat from './Chat';

vi.mock('../api', () => ({
  api: {
    getMessages: vi.fn(async () => ({ messages: [
      { id: 'new', trip_id: 'trip-1', member_id: 'b', member_name: 'Bob', message: 'Newer', created_at: '2026-08-31T02:00:00Z' },
      { id: 'old', trip_id: 'trip-1', member_id: 'a', member_name: 'Alice', message: 'Older', created_at: '2026-08-31T01:00:00Z' },
    ] })),
    sendMessage: vi.fn(),
  },
}));

describe('Chat chronology', () => {
  it('shows an announced wait while the first message page is loading', () => {
    vi.mocked(api.getMessages).mockReturnValueOnce(new Promise(() => undefined));

    render(<Chat tripId="trip-1" currentUserId="a" />);

    expect(screen.getByRole('status', { name: 'Loading messages…' })).toBeInTheDocument();
    expect(screen.queryByText('No messages yet. Start the conversation.')).not.toBeInTheDocument();
  });

  it('renders a newest-first API page in chronological reading order', async () => {
    render(<Chat tripId="trip-1" currentUserId="a" />);
    const older = await screen.findByText('Older');
    const newer = screen.getByText('Newer');
    expect(older.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
