import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './App';

vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: null, isLoading: false }),
}));

function LoginProbe() {
  const location = useLocation();
  return <output>{JSON.stringify(location.state)}</output>;
}

describe('protected navigation', () => {
  it('carries a fragment invitation through login in history state', () => {
    render(
      <MemoryRouter initialEntries={['/home#invite=private%2Ftoken']}>
        <Routes>
          <Route path="/home" element={<ProtectedRoute><p>private home</p></ProtectedRoute>} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('{"returnTo":"/home#invite=private%2Ftoken"}')).toBeInTheDocument();
  });
});
