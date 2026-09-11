import { describe, expect, it } from 'vitest';
import { projectPublicStatusEvents } from '@/lib/status-pages/event-projection';
import type { PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';

function snapshot(overrides: Partial<PublicStatusPageSnapshot>): PublicStatusPageSnapshot {
  return {
    generatedAt: '2026-09-10T00:00:00.000Z',
    incidents: [],
    announcements: [],
    ...overrides,
  } as PublicStatusPageSnapshot;
}

describe('public event projection', () => {
  it('merges every surface into one newest-first feed with consistent kinds', () => {
    const events = projectPublicStatusEvents(
      snapshot({
        incidents: [
          {
            id: 'inc-1',
            title: 'Checkout errors',
            status: 'RESOLVED',
            publicImpact: 'MAJOR_OUTAGE',
            createdAt: '2026-09-09T10:00:00.000Z',
            resolvedAt: '2026-09-09T11:00:00.000Z',
          },
        ],
        maintenance: [
          {
            id: 'm-1',
            title: 'DB upgrade',
            state: 'SCHEDULED',
            startAt: '2026-09-11T00:00:00.000Z',
            endAt: null,
          },
        ],
        announcements: [
          {
            id: 'a-1',
            title: 'New region',
            message: 'EU live',
            type: 'INFO',
            startDate: '2026-09-08T00:00:00.000Z',
            endDate: null,
          },
        ],
        changelog: [
          { id: 'c-1', title: 'v1.5', message: 'Shipped', publishedAt: '2026-09-07T00:00:00.000Z' },
        ],
      })
    );
    expect(events.map(event => [event.kind, event.id])).toEqual([
      ['MAINTENANCE', 'm-1'],
      ['INCIDENT', 'inc-1'],
      ['ANNOUNCEMENT', 'a-1'],
      ['CHANGELOG', 'c-1'],
    ]);
    expect(events.find(event => event.kind === 'INCIDENT')?.impact).toBe('MAJOR_OUTAGE');
    expect(events.find(event => event.kind === 'INCIDENT')?.updatedAt).toBe(
      '2026-09-09T11:00:00.000Z'
    );
  });

  it('does not emit a generic announcement for first-class maintenance or changelog', () => {
    const events = projectPublicStatusEvents(
      snapshot({
        maintenance: [
          {
            id: 'm-1',
            title: 'DB upgrade',
            state: 'IN_PROGRESS',
            startAt: '2026-09-09T00:00:00.000Z',
            endAt: null,
          },
        ],
        announcements: [
          {
            id: 'm-1',
            title: 'DB upgrade',
            message: 'dup',
            type: 'MAINTENANCE',
            startDate: '2026-09-09T00:00:00.000Z',
            endDate: null,
          },
        ],
        changelog: [
          { id: 'c-1', title: 'v1.5', message: 'Shipped', publishedAt: '2026-09-07T00:00:00.000Z' },
        ],
      })
    );
    expect(events.filter(event => event.id === 'm-1')).toHaveLength(1);
    expect(events.filter(event => event.kind === 'ANNOUNCEMENT')).toHaveLength(0);
  });

  it('gives an undisclosed incident a deterministic content key instead of fabricating an id', () => {
    const input = snapshot({
      incidents: [
        { status: 'OPEN', title: 'Investigating', createdAt: '2026-09-09T10:00:00.000Z' },
      ],
    });
    const first = projectPublicStatusEvents(input)[0]?.id;
    const second = projectPublicStatusEvents(input)[0]?.id;
    expect(first).toBe(second);
    expect(first).toMatch(/^incident-[0-9a-f]+$/);
  });

  it('keeps a private incident GUID stable across snapshot rebuilds', () => {
    const publicEventId = 'evt_stable_private_incident';
    const first = projectPublicStatusEvents(
      snapshot({
        generatedAt: '2026-09-10T00:00:00.000Z',
        incidents: [{ status: 'OPEN', title: 'Investigating', publicEventId }],
      })
    )[0]?.id;
    const second = projectPublicStatusEvents(
      snapshot({
        generatedAt: '2026-09-10T00:01:00.000Z',
        incidents: [{ status: 'OPEN', title: 'Investigating', publicEventId }],
      })
    )[0]?.id;
    expect(first).toBe(publicEventId);
    expect(second).toBe(publicEventId);
  });

  it('is deterministic ΓÇö identical snapshots produce identical feeds', () => {
    const input = snapshot({
      maintenance: [
        {
          id: 'm-2',
          title: 'B',
          state: 'IN_PROGRESS',
          startAt: '2026-09-09T00:00:00.000Z',
          endAt: null,
        },
        {
          id: 'm-1',
          title: 'A',
          state: 'IN_PROGRESS',
          startAt: '2026-09-09T00:00:00.000Z',
          endAt: null,
        },
      ],
    });
    expect(projectPublicStatusEvents(input)).toEqual(projectPublicStatusEvents(input));
    // Same publishedAt ΓçÆ stable tie-break by id.
    expect(projectPublicStatusEvents(input).map(event => event.id)).toEqual(['m-1', 'm-2']);
  });
});
