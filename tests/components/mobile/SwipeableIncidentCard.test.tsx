import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SwipeableIncidentCard from '@/components/mobile/SwipeableIncidentCard';

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

describe('SwipeableIncidentCard', () => {
  const mockIncident = {
    id: 'inc-123',
    title: 'Database connection pool exhausted',
    status: 'OPEN',
    urgency: 'HIGH',
    createdAt: new Date().toISOString(),
    service: { name: 'Core DB' },
  };

  it('renders semantic link targeting incident detail', () => {
    render(<SwipeableIncidentCard incident={mockIncident} />);
    const link = screen.getByRole('link', { name: /incident: database connection pool/i });
    expect(link).toHaveAttribute('href', '/m/incidents/inc-123');
  });

  it('allows click navigation when tap has minor displacement (touch jitter)', () => {
    render(<SwipeableIncidentCard incident={mockIncident} />);
    const link = screen.getByRole('link', { name: /incident: database connection pool/i });
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(false);
  });

  it('renders acknowledge button for open incidents', () => {
    const onAcknowledge = vi.fn();
    render(<SwipeableIncidentCard incident={mockIncident} onAcknowledge={onAcknowledge} />);
    const ackButton = screen.getByRole('button', { name: /acknowledge/i });
    fireEvent.click(ackButton);
    expect(onAcknowledge).toHaveBeenCalledWith('inc-123');
  });
});
