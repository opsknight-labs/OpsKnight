import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/notifications/operations',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/settings/NotificationCapacityOverview', () => ({
  default: () => <div />,
}));
vi.mock('@/components/settings/ProviderCapacitySettings', () => ({ default: () => <div /> }));
// The delivery log reports its counts as soon as it loads, like the real one.
vi.mock('@/components/settings/NotificationOperations', () => ({
  default: function NotificationOperationsStub({
    onStatsChange,
  }: {
    onStatsChange?: (stats: Record<string, number>) => void;
  }) {
    useEffect(() => {
      onStatsChange?.({ FAILED: 7, PENDING: 2 });
    }, [onStatsChange]);
    return <div>delivery log</div>;
  },
}));

import NotificationOperationsPage from '@/components/settings/notifications/NotificationOperationsPage';

describe('NotificationOperationsPage', () => {
  it('fills the Overview status cards without opening the Delivery Log tab', () => {
    render(
      <NotificationOperationsPage
        capacities={[]}
        workerCount={1}
        campaigns={[]}
        initialPaused={false}
        canManage={false}
        watermarks={{ low: 1, high: 2, source: 'default', revision: null }}
        runtime={null}
        queueHealth={null}
        subscriptionStates={[]}
        feedbackTypes={[]}
        userRole="ADMIN"
      />
    );

    // 7 failed + 2 pending: the cards show the counts and the log itself stays hidden.
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    const panel = screen.getByText('delivery log').closest('[role="tabpanel"]');
    expect(panel?.getAttribute('data-state')).toBe('inactive');
    expect(panel?.className).toContain('data-[state=inactive]:hidden');
  });
});
