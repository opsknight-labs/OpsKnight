import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MaintenanceV3 from '@/components/status-page/v3/MaintenanceV3';
import AnnouncementsV3 from '@/components/status-page/v3/AnnouncementsV3';
import IncidentsV3 from '@/components/status-page/v3/IncidentsV3';
import { StatusLocaleProvider } from '@/lib/status-pages/i18n/context';

const day = '2026-03-04T00:00:00.000Z';

describe('status page V3 strings follow the page locale', () => {
  it('localizes the all-day label and date in maintenance and announcements', () => {
    render(
      <StatusLocaleProvider locale="fr">
        <MaintenanceV3
          timeZone="UTC"
          maintenance={[
            {
              id: 'm1',
              title: 'DB upgrade',
              state: 'SCHEDULED',
              startAt: day,
              endAt: null,
              allDay: true,
              timeMode: 'ALL_DAY',
            },
          ]}
        />
        <AnnouncementsV3
          timeZone="UTC"
          announcements={[
            {
              id: 'a1',
              title: 'Heads up',
              message: 'm',
              type: 'INFO',
              startDate: day,
              endDate: null,
              allDay: true,
              timeMode: 'ALL_DAY',
            },
          ]}
        />
      </StatusLocaleProvider>
    );
    expect(screen.queryByText(/All day/)).toBeNull();
    expect(screen.getAllByText(/Toute la journée · 4 mars 2026/).length).toBeGreaterThan(0);
  });

  it('localizes ongoing and resolved durations on incidents', () => {
    const start = new Date(Date.now() - 5 * 60_000).toISOString();
    render(
      <StatusLocaleProvider locale="de">
        <IncidentsV3
          timeZone="UTC"
          incidents={[
            { id: 'i1', title: 'Open one', status: 'OPEN', createdAt: start },
            {
              id: 'i2',
              title: 'Closed one',
              status: 'RESOLVED',
              createdAt: '2026-03-04T10:00:00.000Z',
              resolvedAt: '2026-03-04T10:30:00.000Z',
            },
          ]}
        />
      </StatusLocaleProvider>
    );
    expect(screen.queryByText(/Ongoing/)).toBeNull();
    expect(screen.queryByText(/Resolved in/)).toBeNull();
    expect(screen.getAllByText(/Laufend · \d+m/).length).toBeGreaterThan(0);
  });
});
