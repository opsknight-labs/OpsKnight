import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PolicyDirectoryList from '@/components/policies/PolicyDirectoryList';
import type { PolicyDirectoryItem } from '@/components/policies/PolicyDirectoryCard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/policies',
}));

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

const policy: PolicyDirectoryItem = {
  id: 'p1',
  name: 'Payments Escalation',
  description: 'Payments on-call',
  updatedAt: new Date(),
  stepCount: 2,
  serviceCount: 2,
  services: [
    { id: 's1', name: 'Billing' },
    { id: 's2', name: 'Ledger' },
  ],
  steps: [
    {
      id: 'st1',
      stepOrder: 0,
      delayMinutes: 0,
      targetType: 'SCHEDULE',
      targetSchedule: { id: 'sc1', name: 'Primary On-Call' },
    },
    {
      id: 'st2',
      stepOrder: 1,
      delayMinutes: 15,
      targetType: 'TEAM',
      targetTeam: { id: 't1', name: 'Payments' },
    },
  ],
};

const pagination = { currentPage: 1, totalPages: 1, totalItems: 1, itemsPerPage: 50 };

describe('PolicyDirectoryList', () => {
  beforeEach(() => window.localStorage.clear());

  it('renders the dense table with step summary, team, services and menu', () => {
    render(
      <PolicyDirectoryList
        policies={[policy]}
        pagination={pagination}
        filterCounts={{ total: 1, inUse: 1, unassigned: 0 }}
      />
    );
    const table = screen.getByRole('table', { name: 'Escalation policies' });
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Payments Escalation' })).toHaveAttribute(
      'href',
      '/policies/p1'
    );
    expect(within(table).getByText(/escalates in 15m/)).toBeInTheDocument();
    expect(within(table).getByText('Notify Primary On-Call')).toBeInTheDocument();
    expect(within(table).getByText('Payments')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Billing +1' })).toHaveAttribute(
      'href',
      '/services/s1'
    );
    expect(
      within(table).getByRole('button', { name: 'Actions for Payments Escalation' })
    ).toBeInTheDocument();
  });

  it('switches to compact cards', () => {
    render(<PolicyDirectoryList policies={[policy]} pagination={pagination} />);
    fireEvent.click(screen.getByRole('button', { name: 'Card view' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Configure Rules')).toBeInTheDocument();
    expect(screen.getByText('Total duration ~15m')).toBeInTheDocument();
  });

  it('keeps the filtered empty state with a reset action', () => {
    render(
      <PolicyDirectoryList
        policies={[]}
        filterCounts={{ total: 3, inUse: 3, unassigned: 0 }}
        currentSearch="nope"
      />
    );
    expect(screen.getByText('No matching escalation policies')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset Filters' })).toBeInTheDocument();
  });

  it('folds the old guide rail into a header popover and the onboarding empty state', () => {
    const { unmount } = render(<PolicyDirectoryList policies={[policy]} pagination={pagination} />);
    expect(screen.getByRole('link', { name: 'On-Call Schedules' })).toHaveAttribute(
      'href',
      '/schedules'
    );
    fireEvent.click(screen.getByRole('button', { name: 'How escalation works' }));
    const guide = screen.getByRole('dialog', { name: 'How escalation works' });
    expect(within(guide).getByText(/0m initial delay/)).toBeInTheDocument();
    expect(within(guide).getByRole('link', { name: /On-Call Schedules/ })).toHaveAttribute(
      'href',
      '/schedules'
    );
    unmount();

    render(
      <PolicyDirectoryList policies={[]} filterCounts={{ total: 0, inUse: 0, unassigned: 0 }} />
    );
    expect(screen.getByText('No Escalation Policies Configured')).toBeInTheDocument();
    expect(screen.getByText(/after 15–30 minutes/)).toBeInTheDocument();
    for (const [name, href] of [
      [/Services Directory/, '/services'],
      [/Teams & Members/, '/teams'],
    ] as const) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('shows the setup callout only when policies need attention', () => {
    const { rerender } = render(
      <PolicyDirectoryList
        policies={[policy]}
        pagination={pagination}
        filterCounts={{ total: 4, inUse: 3, unassigned: 1, needsSetup: 2 }}
      />
    );
    const callout = screen.getByRole('status');
    expect(callout).toHaveTextContent('2 policies have no steps');
    expect(callout).toHaveTextContent('1 policy is not used by any service');
    expect(
      within(callout).getByRole('button', { name: 'Show policies needing setup' })
    ).toBeVisible();
    expect(within(callout).getByRole('button', { name: 'Show unassigned' })).toBeVisible();

    rerender(
      <PolicyDirectoryList
        policies={[policy]}
        pagination={pagination}
        filterCounts={{ total: 4, inUse: 4, unassigned: 0, needsSetup: 0 }}
      />
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});
