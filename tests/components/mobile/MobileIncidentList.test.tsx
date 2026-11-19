import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import MobileIncidentList from '@/components/mobile/MobileIncidentList';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const snooze = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/app/(app)/incidents/snooze-actions', () => ({ snoozeIncidentWithDuration: snooze }));

type MockIncident = { id: string; title: string };
type SwipeableIncidentCardProps = {
  incident: MockIncident;
  onAcknowledge?: (id: string) => void;
  onSnooze?: (id: string) => void;
};

// Mock the child component to isolate status-transport logic from animation libraries.
vi.mock('@/components/mobile/SwipeableIncidentCard', () => ({
  default: ({ incident, onAcknowledge, onSnooze }: SwipeableIncidentCardProps) => (
    <div data-testid={`incident-card-${incident.id}`}>
      <span>{incident.title}</span>
      {onAcknowledge && <button onClick={() => onAcknowledge(incident.id)}>Acknowledge</button>}
      {onSnooze && <button onClick={() => onSnooze(incident.id)}>Snooze</button>}
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

  it('snoozes for a finite duration only after confirmation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const incident = {
      id: 'inc-2',
      title: 'Disk full',
      status: 'OPEN' as const,
      urgency: 'HIGH',
      createdAt: new Date().toISOString(),
      service: { name: 'Storage' },
    };
    render(<MobileIncidentList incidents={[incident]} filter="all" />);

    await act(async () => {
      fireEvent.click(await screen.findByText('Snooze'));
    });
    expect(snooze).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText('Snooze'));
    });
    await waitFor(() => expect(snooze).toHaveBeenCalledWith('inc-2', 60));
    expect(fetchMock).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
