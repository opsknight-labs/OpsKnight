import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import MobileIncidentList from '@/components/mobile/MobileIncidentList';
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

// Mock the child component to isolate logic testing from animation libraries
vi.mock('@/components/mobile/SwipeableIncidentCard', () => ({
  default: ({ incident, onAcknowledge, onSnooze, onResolve }: any) => (
    <div data-testid={`incident-card-${incident.id}`}>
      <span>{incident.title}</span>
      {onAcknowledge && <button onClick={() => onAcknowledge(incident.id)}>Acknowledge</button>}
    </div>
  ),
}));

describe('MobileIncidentList', () => {
  it('acknowledges incident when action is triggered', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MobileIncidentList
        incidents={[
          {
            id: 'inc-1',
            title: 'API Down',
            status: 'OPEN',
            urgency: 'HIGH',
            createdAt: new Date().toISOString(),
            service: { name: 'Payments' },
          },
        ]}
        filter="open"
      />
    );

    // Wait for render
    const card = await screen.findByTestId('incident-card-inc-1');
    expect(card).toBeDefined();

    // Trigger action via mock button
    const ackBtn = screen.getByText('Acknowledge');
    await act(async () => {
      fireEvent.click(ackBtn);
    });

    await waitFor(() => {
      const expectedUrl = new URL(
        '/api/mobile/incidents/inc-1/status',
        window.location.origin
      ).toString();
      expect(fetchMock).toHaveBeenCalledWith(
        expectedUrl,
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });
});
