import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ErrorPageShell from '@/components/errors/ErrorPageShell';
import GlobalError from '@/app/global-error';

describe('error pages', () => {
  it('shell shows what happened, two actions and the request id', () => {
    render(<ErrorPageShell code="404" title="Lost" message="Gone." requestId="req-1" />);
    expect(screen.getByRole('heading', { name: 'Lost' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Help and support' })).toHaveAttribute('href', '/help');
    expect(screen.getByText('req-1')).toBeInTheDocument();
  });

  it('global-error renders an alert with the correlation id and retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('x'), { digest: 'abc' });
    // <html> inside a div warns in jsdom; the content is what matters here.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<GlobalError error={err} reset={() => {}} />, { container: document.documentElement });
    expect(screen.getByRole('alert')).toHaveTextContent('Correlation ID: abc');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
