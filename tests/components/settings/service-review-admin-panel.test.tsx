import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ notify: toast }));
const actions = vi.hoisted(() => ({
  runServiceReviewsNow: vi.fn(),
  saveServiceReviewSettings: vi.fn(),
  sendServiceReviewPreview: vi.fn(),
  setTeamServicesInReview: vi.fn(),
}));
vi.mock('@/app/(app)/settings/service-review-actions', () => actions);

import ServiceReviewAdminPanel from '@/components/settings/ServiceReviewAdminPanel';

const props = {
  config: {
    enabled: true,
    freezeWarningEnabled: false,
    dayOfMonth: 1,
    hour: 9,
    timeZone: 'UTC',
    summaryEmails: [],
  },
  teams: [{ id: 't1', name: 'Payments', included: 1, total: 3 }],
  runs: [
    {
      period: '2026-10',
      kind: 'DIGEST',
      recipient: 'ann@example.com',
      status: 'SKIPPED',
      serviceCount: 1,
      createdAt: '2026-11-01T09:00:00.000Z',
    },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe('ServiceReviewAdminPanel', () => {
  it('previews the next run and words run statuses with a timestamp', () => {
    render(<ServiceReviewAdminPanel {...props} />);
    expect(screen.getByText(/^Next run: /)).toHaveTextContent('(UTC)');
    expect(screen.getByText('Skipped, nothing to report')).toBeInTheDocument();
    expect(screen.getByText(/Nov 1, 2026/)).toBeInTheDocument();
  });

  it('confirms Run now with a non-destructive dialog', async () => {
    actions.runServiceReviewsNow.mockResolvedValue({
      sent: 2,
      alreadySent: 0,
      skipped: 1,
      failed: 0,
    });
    render(<ServiceReviewAdminPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Send now' })).not.toHaveClass(
      'bg-destructive'
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(actions.runServiceReviewsNow).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('refreshes the counts after including a team', async () => {
    actions.setTeamServicesInReview.mockResolvedValue({ count: 2 });
    render(<ServiceReviewAdminPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Include all' }));
    await waitFor(() => expect(actions.setTeamServicesInReview).toHaveBeenCalledWith('t1', true));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // Saving is its own action: it stays available while a team change runs.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
