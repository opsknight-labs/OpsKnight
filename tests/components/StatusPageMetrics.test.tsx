import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import StatusPageMetrics from '@/components/status-page/StatusPageMetrics';

describe('StatusPageMetrics', () => {
  const now = new Date('2026-08-19T12:00:00.000Z');
  const thirtyDaysAgo = new Date('2026-07-20T12:00:00.000Z');
  const ninetyDaysAgo = new Date('2026-05-21T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const services = [{ id: 'svc-1', name: 'OpsKnight API' }];

  it('should not multiply downtime when multiple incidents overlap concurrently', () => {
    // 5 concurrent incidents during the same 2-hour window on Aug 1
    const incidents = [
      {
        id: 'inc-1',
        serviceId: 'svc-1',
        createdAt: '2026-08-01T10:00:00.000Z',
        resolvedAt: '2026-08-01T12:00:00.000Z',
        status: 'RESOLVED',
        urgency: 'HIGH',
      },
      {
        id: 'inc-2',
        serviceId: 'svc-1',
        createdAt: '2026-08-01T10:30:00.000Z',
        resolvedAt: '2026-08-01T12:00:00.000Z',
        status: 'RESOLVED',
        urgency: 'HIGH',
      },
      {
        id: 'inc-3',
        serviceId: 'svc-1',
        createdAt: '2026-08-01T10:00:00.000Z',
        resolvedAt: '2026-08-01T11:30:00.000Z',
        status: 'RESOLVED',
        urgency: 'HIGH',
      },
    ];

    render(
      <StatusPageMetrics
        services={services}
        incidents={incidents}
        thirtyDaysAgo={thirtyDaysAgo}
        ninetyDaysAgo={ninetyDaysAgo}
      />
    );

    // 2 hours downtime over 30 days (720 hours) is ~99.722% uptime
    // NOT 6 hours of duplicate downtime (which would be lower)
    expect(screen.getByText('OpsKnight API')).toBeDefined();
    expect(screen.getByText(/99\.72/)).toBeDefined();
    expect(screen.getAllByText(/3 incident/i).length).toBeGreaterThanOrEqual(1);
  });

  it('should return 100.000% uptime when there are no incidents', () => {
    render(
      <StatusPageMetrics
        services={services}
        incidents={[]}
        thirtyDaysAgo={thirtyDaysAgo}
        ninetyDaysAgo={ninetyDaysAgo}
      />
    );

    const percentBadges = screen.getAllByText('100.000%');
    expect(percentBadges.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('0 incidents').length).toBe(2);
  });
});
