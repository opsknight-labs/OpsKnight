import { describe, expect, it, vi } from 'vitest';
import {
  adoptWarRoomChannel,
  claimWarRoomProvisioning,
  closeWarRoom,
} from '@/lib/war-room/repository';

describe('war-room generation lifecycle', () => {
  it('creates a new generation when an operator reopens a closed room', async () => {
    const tx = {
      incidentWarRoom: {
        findFirst: vi.fn().mockResolvedValue({ id: 'old-room', generation: 2, state: 'CLOSED' }),
        create: vi.fn().mockResolvedValue({
          id: 'new-room',
          generation: 3,
          state: 'PROVISIONING',
          provisioningToken: 'lease',
        }),
        update: vi.fn(),
      },
    };

    const result = await claimWarRoomProvisioning(tx as never, {
      incidentId: 'incident-1',
      provider: 'MICROSOFT_TEAMS',
      reopen: true,
    });

    expect(result.claimed).toBe(true);
    expect(tx.incidentWarRoom.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'incident-1',
          generation: 3,
          state: 'PROVISIONING',
        }),
      })
    );
    expect(tx.incidentWarRoom.update).not.toHaveBeenCalled();
  });

  it('does not silently reopen a closed generation without explicit lifecycle intent', async () => {
    const existing = { id: 'old-room', generation: 1, state: 'CLOSED' };
    const tx = {
      incidentWarRoom: {
        findFirst: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const result = await claimWarRoomProvisioning(tx as never, {
      incidentId: 'incident-1',
      provider: 'MICROSOFT_TEAMS',
    });
    expect(result).toEqual({ claimed: false, warRoom: existing });
    expect(tx.incidentWarRoom.create).not.toHaveBeenCalled();
  });

  it('fences close to the incident, provider, and active state', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const result = await closeWarRoom({ incidentWarRoom: { updateMany } } as never, {
      incidentId: 'incident-1',
      warRoomId: 'room-1',
      provider: 'MICROSOFT_TEAMS',
    });
    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'room-1',
          incidentId: 'incident-1',
          provider: 'MICROSOFT_TEAMS',
        }),
        data: expect.objectContaining({ state: 'CLOSED', provisioningToken: null, projectionLeaseToken: null, projectionLeaseExpiresAt: null }),
      })
    );
    const where = updateMany.mock.calls[0][0].where;
    expect(where.state.in).not.toContain('AMBIGUOUS');
    expect(where.state.in).toContain('CLOSING');
  });

  it('adopts a channel as READY only while the incident remains active', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      incidentWarRoom: {
        findUnique: vi.fn().mockResolvedValue({
          state: 'PROVISIONING',
          provisioningToken: 'lease-a',
          incident: { status: 'OPEN' },
        }),
        updateMany,
      },
    };

    await expect(
      adoptWarRoomChannel(tx as never, {
        warRoomId: 'room-1',
        provisioningToken: 'lease-a',
        tenantId: 'tenant-1',
        teamId: 'team-1',
        channelId: 'channel-1',
        channelName: 'incident-room',
        channelUrl: 'https://teams.example/channel-1',
      })
    ).resolves.toBe('READY');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'READY',
          providerChannelId: 'channel-1',
          closedAt: null,
          provisioningToken: null,
        }),
      })
    );
  });

  it('adopts an in-flight channel as CLOSED when resolution wins the race', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      incidentWarRoom: {
        findUnique: vi.fn().mockResolvedValue({
          state: 'AMBIGUOUS',
          provisioningToken: 'reconcile-lease',
          incident: { status: 'RESOLVED' },
        }),
        updateMany,
      },
    };

    await expect(
      adoptWarRoomChannel(tx as never, {
        warRoomId: 'room-1',
        provisioningToken: 'reconcile-lease',
        tenantId: 'tenant-1',
        teamId: 'team-1',
        channelId: 'channel-1',
        channelName: 'incident-room',
      })
    ).resolves.toBe('CLOSED');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'CLOSED',
          providerChannelId: 'channel-1',
          provisioningToken: null,
        }),
      })
    );
    expect(updateMany.mock.calls[0][0].data.closedAt).toBeInstanceOf(Date);
  });

  it('refuses final adoption after a resolve or retry has already fenced the lease', async () => {
    const updateMany = vi.fn();
    const tx = {
      incidentWarRoom: {
        findUnique: vi.fn().mockResolvedValue({
          state: 'AMBIGUOUS',
          provisioningToken: null,
          incident: { status: 'RESOLVED' },
        }),
        updateMany,
      },
    };

    await expect(
      adoptWarRoomChannel(tx as never, {
        warRoomId: 'room-1',
        provisioningToken: 'stale-lease',
        tenantId: 'tenant-1',
        teamId: 'team-1',
        channelId: 'channel-1',
        channelName: 'incident-room',
      })
    ).resolves.toBe('FENCED');
    expect(updateMany).not.toHaveBeenCalled();
  });
});
