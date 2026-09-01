import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LoadingIndicator, { LoadingLabel } from './LoadingIndicator';

describe('LoadingIndicator', () => {
  it('announces a page wait while keeping the animation decorative', () => {
    render(<LoadingIndicator label="Loading trips…" />);

    const status = screen.getByRole('status', { name: 'Loading trips…' });
    expect(status).toHaveTextContent('Loading trips…');
    expect(status.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('keeps an inline button wait readable without creating a nested live region', () => {
    render(<button type="button"><LoadingLabel label="Saving…" /></button>);

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
