import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateBundlePreference = vi.hoisted(() => vi.fn());
const notifyError = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/settings/noise-actions', () => ({ updateBundlePreference }));
vi.mock('@/lib/toast', () => ({ notify: { error: notifyError } }));
vi.mock('@/lib/notification-noise/loader', () => ({}));

import NoiseSection from '@/components/settings/NoiseSection';
import MobileNoiseCard from '@/components/mobile/MobileNoiseCard';
import { notificationNoiseInsights } from '@/lib/notification-noise/insights';
import { buildNoiseReport } from '@/lib/notification-noise/report';

const quiet = {
  report: buildNoiseReport([], new Map()),
  insights: [],
  bundleLowUrgencyPages: false,
};
const report = buildNoiseReport(
  [{ day: '2026-11-10', serviceId: 'svc-a', hour: 2, pages: 10, acted: 1, autoResolved: 6 }],
  new Map([['svc-a', 'Payments']])
);
const noisy = {
  report,
  insights: notificationNoiseInsights({ report, quietHoursEnabled: false, endpoints: [] }),
  bundleLowUrgencyPages: false,
};

describe('Noise section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateBundlePreference.mockResolvedValue({ success: true });
  });

  it('shows only the opt-in when there is nothing to report', () => {
    render(<NoiseSection overview={quiet} />);
    expect(
      screen.getByRole('switch', { name: 'Bundle low-urgency pages' }).getAttribute('aria-checked')
    ).toBe('false');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Suggestions')).toBeNull();
  });

  it('shows the report and suggestions that open the existing editors', () => {
    render(<NoiseSection overview={noisy} />);
    expect(screen.getByText(/10 pages, 10% acted on, 6 resolved by themselves/)).toBeTruthy();
    expect(screen.getByText(/Most pages arrive around/).textContent).toContain('02:00');
    expect(screen.getByRole('cell', { name: 'Payments' })).toBeTruthy();
    const links = screen.getAllByRole('link').map(link => link.getAttribute('href'));
    expect(links).toEqual(['/services/svc-a/notifications', '/settings/profile?tab=schedule']);
  });

  it('saves the opt-in and rolls back when the save is refused', async () => {
    render(<NoiseSection overview={quiet} />);
    const toggle = screen.getByRole('switch', { name: 'Bundle low-urgency pages' });
    fireEvent.click(toggle);
    await waitFor(() => expect(updateBundlePreference).toHaveBeenCalledWith(true));
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));

    updateBundlePreference.mockResolvedValue({ success: false, error: 'Not available.' });
    fireEvent.click(toggle);
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('Not available.'));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('has a mobile card with the same opt-in, summary and suggestions', async () => {
    render(<MobileNoiseCard overview={noisy} />);
    expect(screen.getByText(/10 pages, 10%\s+acted on/)).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    fireEvent.click(screen.getByRole('switch', { name: 'Bundle low-urgency pages' }));
    await waitFor(() => expect(updateBundlePreference).toHaveBeenCalledWith(true));
  });
});
