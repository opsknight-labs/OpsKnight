import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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
});
