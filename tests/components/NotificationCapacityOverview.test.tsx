import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationCapacityOverview from '@/components/settings/NotificationCapacityOverview';

const capacity = [
  {
    channel: 'EMAIL',
    configuredRatePerSecond: 500,
    effectiveRatePerSecond: 250,
    bulkRatePerSecond: 200,
    maxInFlight: 50,
    adaptiveBackpressure: true,
  },
];

describe('NotificationCapacityOverview', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders capacity and campaign progress without recipient data', () => {
    render(
      <NotificationCapacityOverview
        capacities={capacity}
        workerCount={3}
        initialPaused={false}
        canManage
        campaigns={[
          {
            id: 'fanout-1',
            sourceType: 'STATUS_PAGE_INCIDENT',
            status: 'RUNNING',
            materializedTargets: 1000,
            completedTargets: 750,
            failedTargets: 2,
          },
        ]}
      />
    );
    expect(screen.getByText(/250\/s/)).toBeInTheDocument();
    expect(screen.getByText('1000 queued · 750 delivered · 2 failed')).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('lets administrators pause bulk delivery', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(
      <NotificationCapacityOverview
        capacities={capacity}
        workerCount={0}
        campaigns={[]}
        initialPaused={false}
        canManage
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pause bulk' }));
    await waitFor(() => expect(screen.getByText('Paused')).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/admin/notifications/capacity',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('keeps auditor views read-only', () => {
    render(
      <NotificationCapacityOverview
        capacities={capacity}
        workerCount={0}
        campaigns={[]}
        initialPaused
        canManage={false}
      />
    );
    expect(screen.queryByRole('button', { name: /bulk/i })).not.toBeInTheDocument();
  });
});
