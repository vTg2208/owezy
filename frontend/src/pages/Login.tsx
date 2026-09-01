import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { safeReturnTo } from '../utils/navigation';
import { LoadingLabel } from '../components/LoadingIndicator';

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
    <main className="auth-layout">
      <aside className="auth-mood" aria-label="Sunset by the sea">
        <div className="auth-mood-copy">
          <h2>Keep the memories.<br />We’ll keep the maths.</h2>
          <p className="mt-3">A calmer way to share every chai, cab, room, and last-minute detour.</p>
        </div>
      </aside>
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-form">
          <Link to="/" className="brand-word block w-fit text-5xl no-underline">Owezy</Link>
          <header className="my-9">
            <h1 id="login-title" className="text-4xl">Welcome back</h1>
            <p className="mt-2 text-muted">Log in to open your trips.</p>
          </header>

        {params.get('verified') === 'pending' && <p role="status" className="notice notice-success mb-4">Account created. Verify the link in your email, then log in.</p>}
        {error && <p role="alert" className="notice notice-error mb-4">{error}</p>}

        <form onSubmit={handleSubmit} className="form-stack">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" required />
          <button type="submit" disabled={isLoading} className="button button-primary mt-2">{isLoading ? <LoadingLabel label="Logging in…" /> : 'Log in'}</button>
        </form>

        <div className="auth-divider my-6">or</div>
        <button type="button" onClick={() => void perform(loginWithGoogle)} disabled={isLoading} className="button button-secondary w-full">Continue with Google</button>
          <p className="mt-7 text-muted">New here? <Link to="/register" state={location.state} className="font-bold">Create an account</Link></p>
        </div>
      </section>
    </main>
  );
}
