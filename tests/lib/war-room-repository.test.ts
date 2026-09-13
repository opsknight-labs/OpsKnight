import { describe, expect, it, vi } from 'vitest';
import { claimWarRoomProvisioning, closeWarRoom } from '@/lib/war-room/repository';

describe('war-room generation lifecycle', () => {
  it('creates a new generation when an operator reopens a closed room', async () => {
    const tx = {
      incidentWarRoom: {
        findFirst: vi.fn().mockResolvedValue({ id: 'old-room', generation: 2, state: 'CLOSED' }),
        create: vi.fn().mockResolvedValue({ id: 'new-room', generation: 3, state: 'PROVISIONING', provisioningToken: 'lease' }),
        update: vi.fn(),
      },
    };

    const result = await claimWarRoomProvisioning(tx as never, {
      incidentId: 'incident-1', provider: 'MICROSOFT_TEAMS', reopen: true,
    });

    expect(result.claimed).toBe(true);
    expect(tx.incidentWarRoom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ incidentId: 'incident-1', generation: 3, state: 'PROVISIONING' }),
    }));
    expect(tx.incidentWarRoom.update).not.toHaveBeenCalled();
  });

  it('does not silently reopen a closed generation without explicit lifecycle intent', async () => {
    const existing = { id: 'old-room', generation: 1, state: 'CLOSED' };
    const tx = { incidentWarRoom: { findFirst: vi.fn().mockResolvedValue(existing), create: vi.fn(), update: vi.fn() } };
    const result = await claimWarRoomProvisioning(tx as never, { incidentId: 'incident-1', provider: 'MICROSOFT_TEAMS' });
    expect(result).toEqual({ claimed: false, warRoom: existing });
    expect(tx.incidentWarRoom.create).not.toHaveBeenCalled();
  });

  it('fences close to the incident, provider, and active state', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const result = await closeWarRoom({ incidentWarRoom: { updateMany } } as never, {
      incidentId: 'incident-1', warRoomId: 'room-1', provider: 'MICROSOFT_TEAMS',
    });
    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'room-1', incidentId: 'incident-1', provider: 'MICROSOFT_TEAMS' }),
      data: expect.objectContaining({ state: 'CLOSED', provisioningToken: null }),
    }));
    const where = updateMany.mock.calls[0][0].where;
    expect(where.state.in).not.toContain('AMBIGUOUS');
  });
});
