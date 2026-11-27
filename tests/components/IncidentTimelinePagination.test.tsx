import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadOlder: vi.fn() }));

vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));
vi.mock('@/components/incident/detail/actions', () => ({
  loadOlderIncidentTimelineActivity: mocks.loadOlder,
}));
vi.mock('@/components/incident/intelligence/UngroupButton', () => ({ default: () => null }));
vi.mock('@/components/incident/detail/TimelineGraph', () => ({ default: () => null }));

import IncidentTimeline, { type Event } from '@/components/incident/detail/IncidentTimeline';

const event = (id: string, at: string): Event => ({
  id,
  message: `Event ${id}`,
  type: 'EVENT',
  createdAt: new Date(at),
});

function timeline(events: Event[]) {
  return (
    <IncidentTimeline
      incidentId="inc-1"
      events={events}
      incidentCreatedAt={new Date('2026-01-01T00:00:00Z')}
      totalEventsCount={5}
    />
  );
}

describe('IncidentTimeline older-activity paging', () => {
  beforeEach(() => mocks.loadOlder.mockReset());

  it('keeps paged-in older events across a refresh and offers load-older again', async () => {
    mocks.loadOlder
      .mockResolvedValueOnce({
        events: [event('e1', '2026-01-02T00:00:00Z')],
        notes: [],
        notifications: [],
      })
      .mockResolvedValueOnce({ events: [], notes: [], notifications: [] });
    const first = [event('e3', '2026-01-04T00:00:00Z'), event('e2', '2026-01-03T00:00:00Z')];
    const { rerender } = render(timeline(first));

    fireEvent.click(screen.getByRole('button', { name: 'Load older activity' }));
    await waitFor(() => expect(screen.getByText('Event e1')).toBeInTheDocument());

    // Nothing older is left, so the button goes away.
    fireEvent.click(screen.getByRole('button', { name: 'Load older activity' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load older activity' })).toBeNull()
    );

    // A refresh re-sends the newest page: the older row stays and the button can return.
    rerender(
      timeline([event('e4', '2026-01-05T00:00:00Z'), event('e3', '2026-01-04T00:00:00Z')])
    );
    expect(screen.getByText('Event e1')).toBeInTheDocument();
    expect(screen.getByText('Event e4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load older activity' })).toBeInTheDocument();
  });
});

describe('IncidentTimeline row entrance animation', () => {
  it('caps the stagger so a long timeline is never hidden behind it, and drops it for reduced motion', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      event(`e${i}`, new Date(Date.UTC(2026, 0, 2) - i * 60_000).toISOString())
    );
    const { container } = render(timeline(many));

    const rows = Array.from(container.querySelectorAll<HTMLElement>('[id^="timeline-e"]'));
    expect(rows.length).toBe(60);
    for (const row of rows) {
      expect(parseInt(row.style.animationDelay, 10)).toBeLessThanOrEqual(400);
      expect(row.className).toContain('motion-reduce:animate-none');
    }
  });
});
