import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SquireAvailabilityNotice from '@/components/squire/SquireAvailabilityNotice';

describe('SquireAvailabilityNotice', () => {
  it('offers Retry with AI for a passing failure', () => {
    render(
      <SquireAvailabilityNotice
        state="basic"
        rateLimit={null}
        canManageAi={false}
        canRetry
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText(/AI could not answer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry with AI' })).toBeInTheDocument();
  });

  it('names a policy reason, hides the retry and links administrators to the providers', () => {
    const { rerender } = render(
      <SquireAvailabilityNotice
        state="basic"
        rateLimit={null}
        canManageAi
        canRetry
        onRetry={vi.fn()}
        reason="No enabled AI provider is allowed to receive Internal data"
      />
    );
    expect(
      screen.getByText(/No enabled AI provider is allowed to receive Internal data\./)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry with AI' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Review AI providers' })).toHaveAttribute(
      'href',
      '/settings/intelligence/ai#providers'
    );
    rerender(
      <SquireAvailabilityNotice
        state="basic"
        rateLimit={null}
        canManageAi={false}
        canRetry
        onRetry={vi.fn()}
        reason="No enabled AI provider is allowed to receive Internal data"
      />
    );
    expect(screen.queryByRole('link', { name: 'Review AI providers' })).toBeNull();
    expect(screen.getByText(/until an administrator changes the AI providers/)).toBeInTheDocument();
  });
});

describe('SquireAvailabilityNotice countdown', () => {
  it('keeps the ticking countdown out of the live region', () => {
    vi.useFakeTimers();
    render(
      <SquireAvailabilityNotice
        state="rate_limited"
        rateLimit={{ until: Date.now() + 5_000 }}
        canManageAi={false}
        canRetry
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(/^Too many requests$/);
    expect(screen.getByText(/You can retry in 5 seconds/)).toHaveClass(
      'line-clamp-2',
      'sm:truncate'
    );
    expect(screen.getByRole('button', { name: 'Retry in 5s' })).toBeDisabled();
    vi.useRealTimers();
  });
});
