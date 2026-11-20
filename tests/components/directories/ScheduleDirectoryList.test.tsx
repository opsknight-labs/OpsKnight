import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScheduleDirectoryList, {
  type ScheduleItem,
} from '@/components/schedules/ScheduleDirectoryList';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/schedules',
}));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));

const responder = { userId: 'u1', name: 'Ann', avatarUrl: null, gender: null };
const schedule: ScheduleItem = {
  id: 's1',
  name: 'Primary',
  timeZone: 'UTC',
  layers: [{ users: [{ userId: 'u1', user: { name: 'Ann' } }] }],
  onCallNow: responder,
  next: { ...responder, name: 'Bob', start: new Date(Date.now() + 3_600_000) },
};

describe('ScheduleDirectoryList', () => {
  beforeEach(() => {
    window.localStorage.clear();
    push.mockClear();
  });

  it('shows the needs-setup callout, quick links and the next handoff on phones', () => {
    render(
      <ScheduleDirectoryList
        schedules={[schedule]}
        filterCounts={{ total: 3, configured: 1, needsSetup: 2 }}
      />
    );
    expect(screen.getByText('2 schedules need setup: they have no responders.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show schedules needing setup' }));
    expect(push).toHaveBeenCalledWith('/schedules?status=needs-setup');
    expect(screen.getByRole('link', { name: 'Escalation Policies' }).getAttribute('href')).toBe(
      '/policies'
    );
    expect(screen.getByRole('link', { name: 'Team Directory' }).getAttribute('href')).toBe(
      '/teams'
    );
    expect(screen.getByRole('button', { name: 'How schedules work' })).toBeTruthy();
    expect(screen.getByText('Next:').parentElement?.textContent).toMatch(/^Next:.*Bob/);
  });

  it('teaches the lifecycle in the empty state', () => {
    render(
      <ScheduleDirectoryList
        schedules={[]}
        filterCounts={{ total: 0, configured: 0, needsSetup: 0 }}
      />
    );
    expect(screen.getByText('Welcome to Schedules')).toBeTruthy();
    expect(screen.getByText('Link Escalation Policies')).toBeTruthy();
  });
});
