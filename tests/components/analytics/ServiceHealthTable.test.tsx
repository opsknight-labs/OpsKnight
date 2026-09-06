import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { SLAMetrics } from '@/lib/sla';
import ServiceHealthTable from '@/components/analytics/ServiceHealthTable';

describe('ServiceHealthTable', () => {
  const services: SLAMetrics['serviceMetrics'] = [
    {
      id: 'svc-1',
      name: 'Alpha Payments',
      count: 12,
      mtta: 15,
      mttr: 120,
      slaBreaches: 4,
      status: 'Critical',
      dynamicStatus: 'CRITICAL',
      activeCount: 2,
      criticalCount: 1,
    },
    {
      id: 'svc-2',
      name: 'Beta Search',
      count: 3,
      mtta: 5,
      mttr: 30,
      slaBreaches: 0,
      status: 'Healthy',
      dynamicStatus: 'OPERATIONAL',
      activeCount: 0,
      criticalCount: 0,
    },
    {
      id: 'svc-3',
      name: 'Gamma Auth',
      count: 8,
      mtta: 25,
      mttr: 70,
      slaBreaches: 2,
      status: 'Degraded',
      dynamicStatus: 'DEGRADED',
      activeCount: 1,
      criticalCount: 0,
    },
  ];

  it('sorts by incident count descending by default', () => {
    const { container } = render(<ServiceHealthTable services={services} />);

    const cards = container.querySelectorAll('.service-health-card');
    expect(cards.length).toBe(3);
    expect(cards[0]?.querySelector('.service-health-name')?.textContent).toBe('Alpha Payments');
  });

  it('filters by critical status', () => {
    const { container } = render(<ServiceHealthTable services={services} />);

    fireEvent.click(screen.getByRole('button', { name: /critical/i }));

    const cards = container.querySelectorAll('.service-health-card');
    expect(cards.length).toBe(1);
    expect(cards[0]?.querySelector('.service-health-name')?.textContent).toBe('Alpha Payments');
  });
});
