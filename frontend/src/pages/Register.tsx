import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { safeReturnTo } from '../utils/navigation';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { register, loginWithGoogle, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = safeReturnTo(location.state);

  useEffect(() => {
    if (user) navigate(returnTo, { replace: true });
  }, [navigate, returnTo, user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setIsLoading(true);
    try {
      await register(email.trim(), password, name.trim());
      navigate('/login?verified=pending', { replace: true, state: location.state });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Registration failed.');
    } finally { setIsLoading(false); }
  };

  const handleGoogle = async () => {
    setError('');
    setIsLoading(true);
    try { await loginWithGoogle(); navigate(returnTo, { replace: true }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Google sign-up failed.'); }
    finally { setIsLoading(false); }
  };

  return (
    <main className="min-h-screen grid place-items-center p-4">
      <section className="paper-card w-full max-w-md" aria-labelledby="register-title">
        <Link to="/" className="brand-word block text-center text-5xl no-underline">Owezy</Link>
        <header className="my-7 text-center">
          <p className="eyebrow">Pack your ledger</p>
          <h1 id="register-title" className="mt-2 text-4xl">Create an account</h1>
        </header>
        {error && <p role="alert" className="notice notice-error mb-4">{error}</p>}
        <form onSubmit={handleSubmit} className="form-stack">
          <label htmlFor="name">Full name</label>
          <input id="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="password-help" minLength={6} required />
          <p id="password-help" className="help-text">Use at least 6 characters. A longer unique password is safer.</p>
          <button type="submit" disabled={isLoading} className="button button-primary mt-2">{isLoading ? 'Creating account…' : 'Create account'}</button>
        </form>
        <div className="auth-divider my-6">or</div>
        <button type="button" onClick={() => void handleGoogle()} disabled={isLoading} className="button button-secondary w-full">Continue with Google</button>
        <p className="mt-7 text-center text-muted">Already packed? <Link to="/login" state={location.state} className="font-bold">Log in</Link></p>
      </section>
    </main>
  );
}
