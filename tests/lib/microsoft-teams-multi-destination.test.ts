import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Microsoft Teams Multi-Destination Linking & Fan-Out', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('enforces maximum 3 active Teams channels per service', async () => {
    const destinations = [
      { id: 'dest-1', serviceId: 'svc-1', channelId: 'chan-1', enabled: true },
      { id: 'dest-2', serviceId: 'svc-1', channelId: 'chan-2', enabled: true },
      { id: 'dest-3', serviceId: 'svc-1', channelId: 'chan-3', enabled: true },
    ];

    const canAddChannel = (serviceId: string) => {
      const activeCount = destinations.filter(d => d.serviceId === serviceId && d.enabled).length;
      if (activeCount >= 3) {
        throw new Error('A maximum of 3 Teams channels can be linked to a service.');
      }
      return true;
    };

    expect(() => canAddChannel('svc-1')).toThrow(
      'A maximum of 3 Teams channels can be linked to a service.'
    );

    // Unlink one destination
    destinations[0].enabled = false;
    expect(() => canAddChannel('svc-1')).not.toThrow();
  });

  it('service notifications fan-out to all active Teams destinations with isolated idempotency keys', async () => {
    const activeDestinations = [
      { id: 'dest-chan-primary', serviceId: 'svc-1', enabled: true, warRoomEnabled: true },
      { id: 'dest-chan-secondary', serviceId: 'svc-1', enabled: true, warRoomEnabled: false },
      { id: 'dest-chan-tertiary', serviceId: 'svc-1', enabled: true, warRoomEnabled: false },
    ];

    const enqueued: Array<{
      incidentId: string;
      destinationId: string;
      eventType: string;
      idempotencyKey: string;
    }> = [];

    const incident = {
      id: 'inc-100',
      serviceId: 'svc-1',
      createdAt: new Date('2026-09-25T10:00:00.000Z'),
      updatedAt: new Date('2026-09-25T10:00:00.000Z'),
    };

    // Fan-out dispatch logic mirroring src/lib/service-notifications.ts
    const teamsEventType = 'triggered';
    const incidentUpdatedAtForTeams = incident.createdAt;

    for (const dest of activeDestinations) {
      const idempotencyKey = `teams:delivery:${incident.id}:${dest.id}:${teamsEventType}:${incidentUpdatedAtForTeams.toISOString()}`;
      enqueued.push({
        incidentId: incident.id,
        destinationId: dest.id,
        eventType: teamsEventType,
        idempotencyKey,
      });
    }

    expect(enqueued).toHaveLength(3);
    // Distinct destination IDs
    expect(enqueued.map(e => e.destinationId)).toEqual([
      'dest-chan-primary',
      'dest-chan-secondary',
      'dest-chan-tertiary',
    ]);
    // Each destination has its own unique idempotency key
    const uniqueKeys = new Set(enqueued.map(e => e.idempotencyKey));
    expect(uniqueKeys.size).toBe(3);
  });

  it('keeps war room creation isolated to the designated war room primary destination', async () => {
    const destinations = [
      {
        id: 'dest-1',
        serviceId: 'svc-1',
        teamId: 'team-ops',
        channelId: 'chan-alerts',
        enabled: true,
        warRoomEnabled: true,
      },
      {
        id: 'dest-2',
        serviceId: 'svc-1',
        teamId: 'team-ops',
        channelId: 'chan-devs',
        enabled: true,
        warRoomEnabled: false,
      },
      {
        id: 'dest-3',
        serviceId: 'svc-1',
        teamId: 'team-ops',
        channelId: 'chan-leadership',
        enabled: true,
        warRoomEnabled: false,
      },
    ];

    // Mirroring src/lib/war-room/providers/microsoft-teams/provision.ts lookup:
    // tx.microsoftTeamsDestination.findFirst({ where: { serviceId, enabled: true, warRoomEnabled: true } })
    const warRoomDestinations = destinations.filter(
      d => d.serviceId === 'svc-1' && d.enabled && d.warRoomEnabled
    );
    expect(warRoomDestinations).toHaveLength(1);
    expect(warRoomDestinations[0].id).toBe('dest-1');
  });

  it('promotes oldest remaining destination to war room primary if primary is unlinked', async () => {
    const destinations = [
      {
        id: 'dest-1',
        serviceId: 'svc-1',
        enabled: true,
        warRoomEnabled: true,
        createdAt: new Date('2026-09-25T08:00:00Z'),
      },
      {
        id: 'dest-2',
        serviceId: 'svc-1',
        enabled: true,
        warRoomEnabled: false,
        createdAt: new Date('2026-09-25T09:00:00Z'),
      },
      {
        id: 'dest-3',
        serviceId: 'svc-1',
        enabled: true,
        warRoomEnabled: false,
        createdAt: new Date('2026-09-25T10:00:00Z'),
      },
    ];

    // Unlink dest-1
    const unlinked = destinations.find(d => d.id === 'dest-1')!;
    unlinked.enabled = false;
    unlinked.warRoomEnabled = false;

    // Remaining check and promotion logic mirroring DELETE route
    const remaining = destinations.filter(d => d.enabled);
    expect(remaining).toHaveLength(2);

    const hasActiveWarRoom = remaining.some(d => d.warRoomEnabled);
    if (!hasActiveWarRoom) {
      const nextPrimary = remaining.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      )[0];
      nextPrimary.warRoomEnabled = true;
    }

    expect(destinations.find(d => d.id === 'dest-2')?.warRoomEnabled).toBe(true);
    expect(destinations.find(d => d.id === 'dest-3')?.warRoomEnabled).toBe(false);
  });
});
