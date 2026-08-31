import { Link } from 'react-router-dom';

export default function Welcome() {
  return (
    <main className="welcome-layout">
      <section className="welcome-copy" aria-labelledby="welcome-title">
        <Link to="/" className="brand-word w-fit text-5xl no-underline">Owezy</Link>
        <h1 id="welcome-title" className="mt-12 max-w-xl">Travel together.<br />Settle simply.</h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Add the chai, cab, and hotel. Owezy keeps the arithmetic calm and the trip moving.
        </p>
        <div className="mt-9 flex max-w-md flex-col gap-3 sm:flex-row">
          <Link to="/login" className="button button-primary">Log in</Link>
          <Link to="/register" className="button button-secondary">Create account</Link>
        </div>
        <p className="mt-10 max-w-md border-t pt-4 text-sm text-muted">Exact splits · receipt proof · confirmed settlements</p>
      </section>
      <div className="welcome-mood" role="img" aria-label="Palm trees and string lights beside the sea at sunset" />
    </main>
  );
}
