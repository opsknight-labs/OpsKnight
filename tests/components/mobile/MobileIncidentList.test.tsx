import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import MobileIncidentList from '@/components/mobile/MobileIncidentList';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

type MockIncident = { id: string; title: string };
type SwipeableIncidentCardProps = {
  incident: MockIncident;
  onAcknowledge?: (id: string) => void;
};

// Mock the child component to isolate status-transport logic from animation libraries.
vi.mock('@/components/mobile/SwipeableIncidentCard', () => ({
  default: ({ incident, onAcknowledge }: SwipeableIncidentCardProps) => (
    <div data-testid={`incident-card-${incident.id}`}>
      <span>{incident.title}</span>
      {onAcknowledge && <button onClick={() => onAcknowledge(incident.id)}>Acknowledge</button>}
    </div>
  ),
}));

describe('MobileIncidentList', () => {
  it('acknowledges an incident through the canonical status API', async () => {
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      clone() {
        return this;
      },
      async json() {
        return { success: true, status: 'ACKNOWLEDGED' };
      },
    } as Response;
    const fetchMock = vi.fn().mockResolvedValue(response);
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

    const card = await screen.findByTestId('incident-card-inc-1');
    expect(card).toBeDefined();

    const ackBtn = screen.getByText('Acknowledge');
    await act(async () => {
      fireEvent.click(ackBtn);
    });

    await waitFor(() => {
      const expectedUrl = new URL('/api/incidents/inc-1/status', window.location.origin).toString();
      expect(fetchMock).toHaveBeenCalledWith(
        expectedUrl,
        expect.objectContaining({
          method: 'PATCH',
          credentials: 'include',
          cache: 'no-store',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Idempotency-Key': expect.stringContaining('incident-status:inc-1:'),
          }),
        })
      );
    });
  });
});
