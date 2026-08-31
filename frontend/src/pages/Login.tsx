import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { safeReturnTo } from '../utils/navigation';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [params] = useSearchParams();
  const { login, loginWithGoogle, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = safeReturnTo(location.state);

  useEffect(() => {
    if (user) navigate(returnTo, { replace: true });
  }, [navigate, returnTo, user]);

  const perform = async (work: () => Promise<void>) => {
    setError('');
    setIsLoading(true);
    try { await work(); navigate(returnTo, { replace: true }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Login failed.'); }
    finally { setIsLoading(false); }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void perform(() => login(email.trim(), password));
  };

  return (
    <main className="min-h-screen grid place-items-center p-4">
      <section className="paper-card w-full max-w-md" aria-labelledby="login-title">
        <Link to="/" className="brand-word block text-center text-5xl no-underline">Owezy</Link>
        <header className="my-7 text-center">
          <p className="eyebrow">Welcome back</p>
          <h1 id="login-title" className="mt-2 text-4xl">Open your trips</h1>
        </header>

        {params.get('verified') === 'pending' && <p role="status" className="notice notice-success mb-4">Account created. Verify the link in your email, then log in.</p>}
        {error && <p role="alert" className="notice notice-error mb-4">{error}</p>}

        <form onSubmit={handleSubmit} className="form-stack">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" required />
          <button type="submit" disabled={isLoading} className="button button-primary mt-2">{isLoading ? 'Logging in…' : 'Log in'}</button>
        </form>

        <div className="auth-divider my-6">or</div>
        <button type="button" onClick={() => void perform(loginWithGoogle)} disabled={isLoading} className="button button-secondary w-full">Continue with Google</button>
        <p className="mt-7 text-center text-muted">New here? <Link to="/register" state={location.state} className="font-bold">Create an account</Link></p>
      </section>
    </main>
  );
}
