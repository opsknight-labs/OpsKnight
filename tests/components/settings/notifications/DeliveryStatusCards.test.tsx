import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DeliveryStatusCards from '@/components/settings/notifications/DeliveryStatusCards';

const mockStats = {
  DELIVERED: 120,
  SENT: 15,
  PENDING: 8,
  FAILED: 3,
  SKIPPED: 22,
  UNKNOWN: 1,
};

describe('DeliveryStatusCards', () => {
  it('renders all 7 status metric cards', () => {
    render(<DeliveryStatusCards stats={mockStats} activeStatus="all" onStatusChange={vi.fn()} />);

    expect(screen.getByText('Total Dispatched')).toBeDefined();
    expect(screen.getByText('Delivered')).toBeDefined();
    expect(screen.getByText('Accepted')).toBeDefined();
    expect(screen.getByText('Pending Queue')).toBeDefined();
    expect(screen.getByText('Unknown')).toBeDefined();
    expect(screen.getByText('Failed / Dead Letter')).toBeDefined();
    expect(screen.getByText('Suppressed / Skipped')).toBeDefined();
  });

  it('displays correct counts from stats', () => {
    render(<DeliveryStatusCards stats={mockStats} activeStatus="all" onStatusChange={vi.fn()} />);

    // Total = sum of all status counts
    const total = Object.values(mockStats).reduce((s, v) => s + v, 0);
    expect(screen.getByText(String(total))).toBeDefined();
    expect(screen.getByText('120')).toBeDefined(); // DELIVERED
    expect(screen.getByText('3')).toBeDefined(); // FAILED
  });

  it('calls onStatusChange with the clicked status', () => {
    const onStatusChange = vi.fn();
    render(
      <DeliveryStatusCards stats={mockStats} activeStatus="all" onStatusChange={onStatusChange} />
    );

    // Click "Failed / Dead Letter" card
    fireEvent.click(screen.getByText('Failed / Dead Letter').closest('button')!);
    expect(onStatusChange).toHaveBeenCalledWith('FAILED');
  });

  it('toggles off an already-active status filter', () => {
    const onStatusChange = vi.fn();
    render(
      <DeliveryStatusCards
        stats={mockStats}
        activeStatus="FAILED"
        onStatusChange={onStatusChange}
      />
    );

    // Clicking the active card again should reset to 'all'
    fireEvent.click(screen.getByText('Failed / Dead Letter').closest('button')!);
    expect(onStatusChange).toHaveBeenCalledWith('all');
  });

  it('calls onStatusChange with all when Total Dispatched is clicked', () => {
    const onStatusChange = vi.fn();
    render(
      <DeliveryStatusCards
        stats={mockStats}
        activeStatus="FAILED"
        onStatusChange={onStatusChange}
      />
    );

    fireEvent.click(screen.getByText('Total Dispatched').closest('button')!);
    expect(onStatusChange).toHaveBeenCalledWith('all');
  });
});
