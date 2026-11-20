import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import RelativeTime, { formatRelativeLabel } from '@/components/patterns/RelativeTime';

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'Asia/Kolkata' }),
}));

const NOW = Date.parse('2026-11-17T10:00:00.000Z');

describe('formatRelativeLabel', () => {
  it.each([
    ['2026-11-17T09:59:30.000Z', 'short', 'just now'],
    ['2026-11-17T09:55:00.000Z', 'short', '5m ago'],
    ['2026-11-17T07:00:00.000Z', 'short', '3h ago'],
    ['2026-11-15T10:00:00.000Z', 'short', '2d ago'],
    ['2026-11-17T12:00:00.000Z', 'short', 'in 2h'],
    ['2026-11-17T09:59:00.000Z', 'long', '1 minute ago'],
    ['2026-11-17T09:55:00.000Z', 'long', '5 minutes ago'],
    ['2026-11-17T09:59:30.000Z', 'narrow', 'Now'],
    ['2026-11-17T09:57:00.000Z', 'narrow', '3m'],
    ['2026-11-15T10:00:00.000Z', 'narrow', '2d'],
  ] as const)('%s (%s) → %s', (iso, format, expected) => {
    expect(formatRelativeLabel(iso, NOW, format, 'UTC')).toBe(expected);
  });

  it('switches to a calendar date after a week, in the given timezone', () => {
    expect(formatRelativeLabel('2026-11-02T20:00:00.000Z', NOW, 'short', 'Asia/Kolkata')).toBe(
      'Nov 3'
    );
    expect(formatRelativeLabel('2025-11-02T20:00:00.000Z', NOW, 'short', 'UTC')).toBe(
      'Nov 2, 2025'
    );
  });
});

describe('<RelativeTime>', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a <time> with ISO dateTime, tabular numbers and the absolute time + zone on hover', () => {
    render(<RelativeTime date="2026-11-17T09:55:00.000Z" now={NOW} />);
    const time = screen.getByText('5m ago');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-11-17T09:55:00.000Z');
    expect(time).toHaveClass('tabular-nums');
    expect(time.getAttribute('title')).toMatch(/Nov 17, 2026.*3:25 PM GMT\+5:30/);
  });

  it('updates itself on its own clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(<RelativeTime date={NOW - 30_000} />);
    expect(screen.getByText('just now')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('1m ago')).toBeInTheDocument();
  });

  it('shows the fallback for missing dates', () => {
    render(<RelativeTime date={null} fallback="Never" />);
    expect(screen.getByText('Never').tagName).toBe('SPAN');
  });
});
