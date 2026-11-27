import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import DueDateBadge, { getDueDateStatus } from './DueDateBadge';

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
