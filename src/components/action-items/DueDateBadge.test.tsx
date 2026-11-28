import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import DueDateBadge, { getDueDateStatus } from './DueDateBadge';
import { actionItemOverdueBefore } from '@/lib/action-item-due-dates';

describe('DueDateBadge', () => {
  it('correctly categorizes overdue, due-soon, and completed dates', () => {
    const fixedNow = new Date('2026-08-31T12:00:00Z');

    // Completed
    expect(getDueDateStatus('2026-08-01', 'COMPLETED', fixedNow).type).toBe('completed');

    // Overdue (yesterday)
    expect(getDueDateStatus('2026-08-30', 'OPEN', fixedNow).type).toBe('overdue');

    // Due soon (tomorrow or in 2 days)
    expect(getDueDateStatus('2026-09-02', 'IN_PROGRESS', fixedNow).type).toBe('due-soon');

    // On track (next week)
    expect(getDueDateStatus('2026-09-15', 'OPEN', fixedNow).type).toBe('on-track');
  });

  it('renders completed badge properly', () => {
    render(
      <DueDateBadge
        dueDate="2026-08-20"
        completedAt="2026-08-21"
        status="COMPLETED"
        userTimeZone="UTC"
      />
    );
    expect(screen.getByText(/Completed/i)).toBeInTheDocument();
  });

  it('renders overdue badge with pulse styling', () => {
    render(<DueDateBadge dueDate="2026-08-01" status="OPEN" userTimeZone="UTC" />);
    expect(screen.getByText(/Overdue/i)).toBeInTheDocument();
  });

  describe('for a viewer west of UTC', () => {
    const originalTz = process.env.TZ;
    beforeEach(() => {
      process.env.TZ = 'America/Los_Angeles';
    });
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it('is due today, not overdue, on the due date itself', () => {
      // 9am on Nov 20 in Los Angeles; the stored due date is 2026-11-20T00:00Z.
      const morningOfDueDate = new Date(2026, 10, 20, 9, 0);

      expect(getDueDateStatus('2026-11-20', 'OPEN', morningOfDueDate)).toEqual({
        type: 'due-soon',
        daysDiff: 0,
      });
      expect(getDueDateStatus('2026-11-20', 'OPEN', new Date(2026, 10, 21, 9, 0))).toEqual({
        type: 'overdue',
        daysDiff: 1,
      });
    });

    it('shows the calendar date, not the day before', () => {
      render(
        <DueDateBadge dueDate="2099-11-20" status="OPEN" userTimeZone="America/Los_Angeles" />
      );
      expect(screen.getByText(/Nov 20, 2099/)).toBeInTheDocument();
    });
  });
});

describe('the overdue rule matches the server', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('is overdue on the UTC day after the due date even where it is still the due date locally', () => {
    process.env.TZ = 'America/Los_Angeles';
    // 8pm on Nov 20 in Los Angeles is already Nov 21 in UTC, so the server counts 2026-11-20 as overdue.
    const now = new Date('2026-11-21T04:00:00Z');
    expect(getDueDateStatus('2026-11-20', 'OPEN', now)).toEqual({ type: 'overdue', daysDiff: 1 });
  });

  it('is due today until the UTC day ends even where the local date has already moved on', () => {
    process.env.TZ = 'Asia/Tokyo';
    // 2am on Nov 21 in Tokyo is still Nov 20 in UTC, so the server does not count 2026-11-20 as overdue.
    const now = new Date('2026-11-20T17:00:00Z');
    expect(getDueDateStatus('2026-11-20', 'OPEN', now)).toEqual({ type: 'due-soon', daysDiff: 0 });
  });

  it.each(['America/Los_Angeles', 'UTC', 'Asia/Kolkata', 'Pacific/Kiritimati'])(
    'agrees with actionItemOverdueBefore around every UTC midnight in %s',
    zone => {
      process.env.TZ = zone;
      const dueDates = ['2026-11-19', '2026-11-20', '2026-11-21'];
      for (let hour = 0; hour < 72; hour += 1) {
        const now = new Date(Date.UTC(2026, 10, 19, 0, 0) + hour * 3_600_000 + 1_000);
        for (const due of dueDates) {
          const overdue = new Date(due).getTime() < actionItemOverdueBefore(now).getTime();
          expect(getDueDateStatus(due, 'OPEN', now).type === 'overdue').toBe(overdue);
        }
      }
    }
  );
});
