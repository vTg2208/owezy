import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Login from './Login';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'firebase-1', email: 'one@example.com', name: 'One', emailVerified: true },
    login: vi.fn(), loginWithGoogle: vi.fn(),
  }),
}));

describe('Login redirect completion', () => {
  it('continues to the dashboard when redirect authentication restores a user', async () => {
    render(<MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<p>Dashboard restored</p>} />
      </Routes>
    </MemoryRouter>);

    expect(await screen.findByText('Dashboard restored')).toBeVisible();
  });
});
