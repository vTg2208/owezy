import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

type AuthStateUser = {
  uid: string; email: string | null; displayName: string | null; emailVerified: boolean;
};

const firebase = vi.hoisted(() => ({
  createUserWithEmailAndPassword: vi.fn(),
  getRedirectResult: vi.fn(async () => null),
  onAuthStateChanged: vi.fn((_auth, listener: (user: AuthStateUser | null) => void) => {
    listener(null);
    return () => undefined;
  }),
  sendEmailVerification: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  updateProfile: vi.fn(async () => undefined),
}));
const backend = vi.hoisted(() => ({
  syncUser: vi.fn<(_email?: string, _name?: string) => Promise<void>>(async () => undefined),
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class GoogleAuthProvider {},
  ...firebase,
}));
vi.mock('../firebase', () => ({ auth: {} }));
vi.mock('../api', () => ({ authAPI: backend }));

function UserProbe() {
  const { user } = useAuth();
  return <output>{user?.name ?? 'signed out'}</output>;
}

function Harness() {
  const auth = useAuth();
  const [result, setResult] = useState('idle');
  const run = (work: () => Promise<void>) => {
    void work().then(() => setResult('done')).catch((error: Error) => setResult(error.message));
  };
  return <>
    <output>{result}</output>
    <button onClick={() => run(auth.loginWithGoogle)}>Google</button>
    <button onClick={() => run(() => auth.register('new@example.com', 'secret12', 'New User'))}>Register</button>
    <button onClick={() => run(() => auth.login('new@example.com', 'secret12'))}>Login</button>
  </>;
}

describe('AuthProvider recovery flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebase.onAuthStateChanged.mockReset().mockImplementation((_auth, listener) => {
      listener(null);
      return () => undefined;
    });
    backend.syncUser.mockReset().mockResolvedValue(undefined);
  });

  it('does not expose a verified Firebase session until backend sync finishes', async () => {
    let finishSync!: () => void;
    backend.syncUser.mockReturnValueOnce(new Promise<void>((resolve) => { finishSync = resolve; }));
    firebase.onAuthStateChanged.mockImplementationOnce((_auth, listener) => {
      void listener({
        uid: 'firebase-1', email: 'ready@example.com', displayName: 'Ready Traveller', emailVerified: true,
      });
      return () => undefined;
    });

    render(<AuthProvider><UserProbe /></AuthProvider>);
    expect(screen.getByText('signed out')).toBeVisible();

    finishSync();
    expect(await screen.findByText('Ready Traveller')).toBeVisible();
  });

  it('ignores an older sync completion after an identity switch', async () => {
    let notify!: (user: AuthStateUser | null) => void;
    let finishFirst!: () => void;
    backend.syncUser.mockReturnValueOnce(new Promise<void>((resolve) => { finishFirst = resolve; }));
    firebase.onAuthStateChanged.mockImplementationOnce((_auth, listener) => {
      notify = listener;
      return () => undefined;
    });
    render(<AuthProvider><UserProbe /></AuthProvider>);

    act(() => { notify({ uid: 'a', email: 'a@example.com', displayName: 'A', emailVerified: true }); });
    act(() => { notify({ uid: 'b', email: 'b@example.com', displayName: 'B', emailVerified: true }); });
    expect(screen.getByText('signed out')).toBeVisible();
    expect(await screen.findByText('B')).toBeVisible();
    await act(async () => finishFirst());
    expect(screen.getByText('B')).toBeVisible();
  });

  it('removes the previous account while the new account is still syncing', async () => {
    let notify!: (user: AuthStateUser | null) => void;
    let finishSecond!: () => void;
    backend.syncUser.mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(new Promise<void>((resolve) => { finishSecond = resolve; }));
    firebase.onAuthStateChanged.mockImplementationOnce((_auth, listener) => {
      notify = listener;
      return () => undefined;
    });
    render(<AuthProvider><UserProbe /></AuthProvider>);

    act(() => { notify({ uid: 'a', email: 'a@example.com', displayName: 'A', emailVerified: true }); });
    expect(await screen.findByText('A')).toBeVisible();
    act(() => { notify({ uid: 'b', email: 'b@example.com', displayName: 'B', emailVerified: true }); });
    expect(screen.getByText('signed out')).toBeVisible();
    await act(async () => finishSecond());
    expect(screen.getByText('B')).toBeVisible();
  });

  it('falls back to redirect when the Google popup cannot start', async () => {
    firebase.signInWithPopup.mockRejectedValueOnce(Object.assign(new Error('popup failed'), {
      code: 'auth/internal-error',
    }));
    render(<AuthProvider><Harness /></AuthProvider>);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Google' }));

    expect(await screen.findByText('done')).toBeVisible();
    expect(firebase.signInWithRedirect).toHaveBeenCalledOnce();
  });

  it('signs out a partially-created account and explains verification delivery failure', async () => {
    const user = { email: 'new@example.com' };
    firebase.createUserWithEmailAndPassword.mockResolvedValueOnce({ user });
    firebase.sendEmailVerification.mockRejectedValue(new Error('network'));
    render(<AuthProvider><Harness /></AuthProvider>);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Register' }));

    expect(await screen.findByText(/account was created, but the verification email could not be sent/i)).toBeVisible();
    expect(firebase.signOut).toHaveBeenCalledOnce();
  });

  it('resends verification during an unverified login attempt and signs back out', async () => {
    const user = { email: 'new@example.com', emailVerified: false };
    firebase.signInWithEmailAndPassword.mockResolvedValueOnce({ user });
    firebase.sendEmailVerification.mockResolvedValueOnce(undefined);
    render(<AuthProvider><Harness /></AuthProvider>);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Login' }));

    expect(await screen.findByText(/a new verification email has been sent/i)).toBeVisible();
    expect(firebase.sendEmailVerification).toHaveBeenCalledWith(user);
    expect(firebase.signOut).toHaveBeenCalledOnce();
  });
});
