import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import GlobalIncidentBanner from '@/components/layout/GlobalIncidentBanner';
import type { CriticalIncidentSummary } from '@/contexts/IncidentAlertContext';

const mockContextValue = {
  currentIncident: null as CriticalIncidentSummary | null,
  currentIndex: 0,
  totalCount: 0,
  isBannerVisible: false,
  isSnoozed: false,
  nextIncident: vi.fn(),
  prevIncident: vi.fn(),
  selectIncident: vi.fn(),
  dismissBanner: vi.fn(),
  snoozeBanner: vi.fn(),
  dismissIncident: vi.fn(),
  acknowledgeIncident: vi.fn(),
  isAcknowledging: false,
  activeCriticalIncidents: [] as CriticalIncidentSummary[],
};

vi.mock('@/contexts/IncidentAlertContext', () => ({
  useIncidentAlert: () => mockContextValue,
}));

describe('GlobalIncidentBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when isBannerVisible is false or currentIncident is null', () => {
    mockContextValue.isBannerVisible = false;
    mockContextValue.currentIncident = null;

    const { container } = render(<GlobalIncidentBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders P1 incident details, service, title, and action buttons', () => {
    mockContextValue.isBannerVisible = true;
    mockContextValue.currentIncident = {
      id: 'inc-p1-123',
      title: 'Payment Gateway Down',
      status: 'OPEN',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date(Date.now() - 600000).toISOString(), // 10 mins ago
      service: { id: 'svc-payments', name: 'Payments API' },
    };
    mockContextValue.totalCount = 1;
    mockContextValue.currentIndex = 0;

    render(<GlobalIncidentBanner />);

    expect(screen.getByText('P1')).toBeDefined();
    expect(screen.getByText('Payments API')).toBeDefined();
    expect(screen.getByText('Payment Gateway Down')).toBeDefined();
    expect(screen.getByText('Active for 10m')).toBeDefined();
    expect(screen.getByText('Triggered')).toBeDefined();
    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /view/i })).toBeDefined();
  });

  it('triggers acknowledgeIncident when clicking Acknowledge', () => {
    mockContextValue.isBannerVisible = true;
    mockContextValue.currentIncident = {
      id: 'inc-p1-123',
      title: 'Payment Gateway Down',
      status: 'OPEN',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date().toISOString(),
      service: { id: 'svc-payments', name: 'Payments API' },
    };

    render(<GlobalIncidentBanner />);

    const ackButton = screen.getByRole('button', { name: /acknowledge/i });
    fireEvent.click(ackButton);

    expect(mockContextValue.acknowledgeIncident).toHaveBeenCalledWith('inc-p1-123');
  });

  it('hides Acknowledge button and displays Acknowledged badge when incident is already acknowledged', () => {
    mockContextValue.isBannerVisible = true;
    mockContextValue.currentIncident = {
      id: 'inc-p1-123',
      title: 'Payment Gateway Down',
      status: 'ACKNOWLEDGED',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date().toISOString(),
      service: { id: 'svc-payments', name: 'Payments API' },
    };

    render(<GlobalIncidentBanner />);

    expect(screen.queryByRole('button', { name: /^acknowledge$/i })).toBeNull();
    expect(screen.getByText('Acknowledged')).toBeDefined();
  });

  it('renders multi-incident carousel controls when totalCount > 1', () => {
    mockContextValue.isBannerVisible = true;
    mockContextValue.totalCount = 3;
    mockContextValue.currentIndex = 1;
    mockContextValue.currentIncident = {
      id: 'inc-p2-456',
      title: 'Database replica lag',
      status: 'OPEN',
      priority: 'P2',
      urgency: 'MEDIUM',
      createdAt: new Date().toISOString(),
      service: { id: 'svc-db', name: 'Postgres Cluster' },
    };

    render(<GlobalIncidentBanner />);

    expect(screen.getByText('2 of 3')).toBeDefined();

    const prevBtn = screen.getByRole('button', { name: /previous critical incident/i });
    const nextBtn = screen.getByRole('button', { name: /next critical incident/i });

    fireEvent.click(prevBtn);
    expect(mockContextValue.prevIncident).toHaveBeenCalledTimes(1);

    fireEvent.click(nextBtn);
    expect(mockContextValue.nextIncident).toHaveBeenCalledTimes(1);
  });

  it('calls dismissBanner when clicking the dismiss X button', () => {
    mockContextValue.isBannerVisible = true;
    mockContextValue.totalCount = 1;
    mockContextValue.currentIncident = {
      id: 'inc-p1-123',
      title: 'Payment Gateway Down',
      status: 'OPEN',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date().toISOString(),
      service: { id: 'svc-payments', name: 'Payments API' },
    };

    render(<GlobalIncidentBanner />);

    const dismissBtn = screen.getByRole('button', { name: /dismiss banner/i });
    fireEvent.click(dismissBtn);

    expect(mockContextValue.dismissBanner).toHaveBeenCalledTimes(1);
  });
});
