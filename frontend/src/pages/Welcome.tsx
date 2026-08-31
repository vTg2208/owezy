import { Link } from 'react-router-dom';

export default function Welcome() {
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <section className="paper-card w-full max-w-3xl text-center py-12 md:py-20" aria-labelledby="welcome-title">
        <p className="eyebrow mb-4">A shared travel notebook</p>
        <h1 id="welcome-title" className="brand-word text-7xl sm:text-8xl md:text-9xl">Owezy</h1>
        <p className="mx-auto mt-6 max-w-xl text-lg md:text-xl text-muted">
          Add the chai, cab, and hotel. Owezy keeps the arithmetic calm and the trip moving.
        </p>
        <div className="mx-auto mt-9 grid max-w-sm gap-3 sm:grid-cols-2">
          <Link to="/login" className="button button-primary">Log in</Link>
          <Link to="/register" className="button button-secondary">Create account</Link>
        </div>
        <p className="mt-10 text-sm text-muted">Exact splits · receipt proof · confirmed settlements</p>
      </section>
    </main>
  );
}
