import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import EmptyState from '@/components/patterns/EmptyState';
import ErrorState from '@/components/patterns/ErrorState';
import {
  CardGridSkeleton,
  DetailPageSkeleton,
  TableRowsSkeleton,
} from '@/components/patterns/Skeletons';
import LegacyEmptyState from '@/components/ui/EmptyState';
import LegacyErrorState from '@/components/ui/ErrorState';
import AnalyticsEmptyState from '@/components/analytics/EmptyState';

describe('EmptyState', () => {
  it('teaches the next step: title, description, primary + secondary action and help link', () => {
    render(
      <EmptyState
        icon={<Inbox />}
        title="No services yet"
        description="Services group alerts into incidents."
        primaryAction={<button type="button">Create service</button>}
        secondaryAction={<button type="button">Import</button>}
        helpLink={{ href: 'https://docs.example.com/services', label: 'Learn about services' }}
      />
    );
    expect(screen.getByRole('heading', { name: 'No services yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create service' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /learn about services/i })).toHaveAttribute(
      'target',
      '_blank'
    );
  });

  it('is what the legacy ui and analytics empty states render', () => {
    expect(LegacyEmptyState).toBe(EmptyState);
    render(<AnalyticsEmptyState title="No data in range" description="Widen the range." />);
    expect(screen.getByRole('heading', { name: 'No data in range' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('names the problem, retries, links back and hides details in a disclosure', () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="Could not load incidents"
        message="The server did not respond."
        errorCode="req_123"
        onRetry={onRetry}
        backHref="/"
        details="TypeError: boom"
      />
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /go back/i })).toHaveAttribute('href', '/');
    expect(screen.getByText('req_123')).toBeInTheDocument();
    expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open');
  });

  it('keeps the legacy wrapper contract (details only with showDetails)', () => {
    const { rerender } = render(<LegacyErrorState details="stack" />);
    expect(screen.queryByText('Technical details')).toBeNull();
    rerender(<LegacyErrorState details="stack" showDetails onRetry={() => {}} />);
    expect(screen.getByText('Technical details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });
});

describe('Skeleton presets', () => {
  it.each([
    ['table rows', <TableRowsSkeleton key="t" rows={3} />],
    ['card grid', <CardGridSkeleton key="c" cards={2} />],
    ['detail page', <DetailPageSkeleton key="d" />],
  ])('%s announce one busy status region', (_name, node) => {
    render(node);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status.querySelector('[aria-hidden="true"] .animate-pulse')).not.toBeNull();
  });
});
