import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { IncidentHeatmapWidget } from '@/components/dashboard/widgets/IncidentHeatmapWidget';

describe('IncidentHeatmapWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-10T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('counts the last 365 days it is fed, not the calendar year it shows', () => {
    render(
      <IncidentHeatmapWidget
        data={[
          { date: '2027-01-09', count: 3 },
          { date: '2026-12-31', count: 2 },
          // Older than 365 days: outside the window, so neither drawn nor counted.
          { date: '2025-12-31', count: 7 },
        ]}
      />
    );
    expect(screen.getByText('5 incidents in the last 365 days')).toBeInTheDocument();
  });

  it("treats today as the viewer's calendar day, not the browser's", () => {
    // 12:00 UTC is already 02:00 on 11 January in Kiritimati (UTC+14).
    render(
      <TimezoneProvider initialTimeZone="Pacific/Kiritimati">
        <IncidentHeatmapWidget data={[{ date: '2027-01-11', count: 4 }]} />
      </TimezoneProvider>
    );
    expect(screen.getByText('4 incidents in the last 365 days')).toBeInTheDocument();
  });
});
