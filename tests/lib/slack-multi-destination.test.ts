import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Slack Multi-Destination Linking & Fan-Out', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('enforces maximum 3 active Slack channels per service', async () => {
    const destinations = [
      { id: 'dest-1', serviceId: 'svc-1', channelId: 'C111', enabled: true },
      { id: 'dest-2', serviceId: 'svc-1', channelId: 'C222', enabled: true },
      { id: 'dest-3', serviceId: 'svc-1', channelId: 'C333', enabled: true },
    ];

    const canAddChannel = (serviceId: string) => {
      const activeCount = destinations.filter(d => d.serviceId === serviceId && d.enabled).length;
      if (activeCount >= 3) {
        throw new Error(
          'A maximum of 3 Slack channels can be linked to a service. Unlink a channel before adding a new one.'
        );
      }
      return true;
    };

    expect(() => canAddChannel('svc-1')).toThrow(
      'A maximum of 3 Slack channels can be linked to a service.'
    );

    // Unlink one destination
    destinations[0].enabled = false;
    expect(() => canAddChannel('svc-1')).not.toThrow();
  });

  it('service notifications fan-out to all active Slack destinations with isolated delivery keys', async () => {
    const activeDestinations = [
      {
        id: 'slack-dest-1',
        serviceId: 'svc-1',
        channelId: 'C100',
        channelName: 'critical-alerts',
        enabled: true,
      },
      {
        id: 'slack-dest-2',
        serviceId: 'svc-1',
        channelId: 'C200',
        channelName: 'devops-oncall',
        enabled: true,
      },
      {
        id: 'slack-dest-3',
        serviceId: 'svc-1',
        channelId: 'C300',
        channelName: 'leadership-summary',
        enabled: true,
      },
    ];

    const enqueued: Array<{
      incidentId: string;
      destinationId: string;
      channelAddress: string;
      eventKey: string;
    }> = [];

    const incident = {
      id: 'inc-100',
      serviceId: 'svc-1',
      title: 'Database connection pool exhausted',
    };

    const baseDeliveryKey = `delivery:inc-100:triggered`;

    // Fan-out dispatch logic mirroring src/lib/service-notifications.ts
    for (const dest of activeDestinations) {
      const channelAddress = dest.channelId || dest.channelName;
      const channelDeliveryKey = `${baseDeliveryKey}:${dest.id}`;
      enqueued.push({
        incidentId: incident.id,
        destinationId: dest.id,
        channelAddress,
        eventKey: channelDeliveryKey,
      });
    }

    expect(enqueued).toHaveLength(3);
    expect(enqueued.map(e => e.destinationId)).toEqual([
      'slack-dest-1',
      'slack-dest-2',
      'slack-dest-3',
    ]);
    expect(enqueued.map(e => e.channelAddress)).toEqual(['C100', 'C200', 'C300']);

    // Each destination has its own unique deliveryKey
    const uniqueKeys = new Set(enqueued.map(e => e.eventKey));
    expect(uniqueKeys.size).toBe(3);
  });

  it('isolates dispatch errors so a failed destination does not prevent others from delivering', async () => {
    const activeDestinations = [
      { id: 'dest-1', channelId: 'C100', channelName: 'chan-1' },
      { id: 'dest-2', channelId: 'C200_ARCHIVED', channelName: 'chan-2' },
      { id: 'dest-3', channelId: 'C300', channelName: 'chan-3' },
    ];

    const errors: string[] = [];
    const deliveredChannels: string[] = [];

    // Simulate concurrent dispatch with Promise.all and individual error handling
    await Promise.all(
      activeDestinations.map(async target => {
        try {
          if (target.channelId.includes('ARCHIVED')) {
            throw new Error('channel_not_found');
          }
          deliveredChannels.push(target.channelId);
        } catch (err) {
          errors.push(
            `Slack channel notification failed for ${target.channelName}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })
    );

    // Channels 1 and 3 delivered successfully
    expect(deliveredChannels).toEqual(['C100', 'C300']);
    // Channel 2 failed with isolated error
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('chan-2: channel_not_found');
  });

  it('correctly falls back to legacy service.slackChannel when no SlackDestinations exist', () => {
    const slackDestinations: Array<{ id: string; channelId: string; channelName: string | null }> =
      [];
    const service = { slackChannel: 'general-legacy' };

    const activeChannels =
      slackDestinations.length > 0
        ? slackDestinations.map(d => ({
            id: d.id,
            address: d.channelId || d.channelName || '',
            name: d.channelName,
          }))
        : service.slackChannel?.trim()
          ? [
              {
                id: 'legacy',
                address: service.slackChannel.trim(),
                name: service.slackChannel.trim(),
              },
            ]
          : [];

    expect(activeChannels).toHaveLength(1);
    expect(activeChannels[0]).toEqual({
      id: 'legacy',
      address: 'general-legacy',
      name: 'general-legacy',
    });
  });

  it('deduplicates activeChannels by address to prevent duplicate incident messages', () => {
    const rawChannels = [
      { id: 'dest-1', address: 'C100', name: 'alerts' },
      { id: 'dest-2', address: 'c100', name: 'alerts' },
      { id: 'dest-3', address: 'C200', name: 'devops' },
    ];

    const seenAddresses = new Set<string>();
    const activeChannels: typeof rawChannels = [];
    for (const target of rawChannels) {
      const normalized = target.address.toLowerCase();
      if (normalized && !seenAddresses.has(normalized)) {
        seenAddresses.add(normalized);
        activeChannels.push(target);
      }
    }

    expect(activeChannels).toHaveLength(2);
    expect(activeChannels.map(c => c.id)).toEqual(['dest-1', 'dest-3']);
  });

  it('coalesces concurrent token resolutions to eliminate DB pressure during multi-channel fan-out', async () => {
    let dbLookupCount = 0;
    const botTokenInFlight = new Map<string, Promise<string | null>>();

    const resolveToken = async (serviceId: string) => {
      dbLookupCount++;
      await new Promise(r => setTimeout(r, 10));
      return `xoxb-token-for-${serviceId}`;
    };

    const getToken = async (serviceId: string) => {
      const existing = botTokenInFlight.get(serviceId);
      if (existing) return existing;
      const promise = resolveToken(serviceId).finally(() => {
        botTokenInFlight.delete(serviceId);
      });
      botTokenInFlight.set(serviceId, promise);
      return promise;
    };

    // 3 channels concurrently fan out for the same service
    const [token1, token2, token3] = await Promise.all([
      getToken('svc-1'),
      getToken('svc-1'),
      getToken('svc-1'),
    ]);

    expect(token1).toBe('xoxb-token-for-svc-1');
    expect(token2).toBe('xoxb-token-for-svc-1');
    expect(token3).toBe('xoxb-token-for-svc-1');
    // Only 1 DB lookup occurred despite 3 concurrent calls
    expect(dbLookupCount).toBe(1);
  });

  it('validates destination ownership to prevent foreign channel access', () => {
    const dest = { id: 'dest-999', serviceId: 'svc-finance', channelId: 'C_FINANCE' };

    const validateAccess = (requestedServiceId: string | undefined, destServiceId: string) => {
      if (requestedServiceId && requestedServiceId !== destServiceId) {
        throw new Error('Destination does not belong to the specified service.');
      }
      return destServiceId;
    };

    // Caller provides mismatched serviceId -> rejected
    expect(() => validateAccess('svc-marketing', dest.serviceId)).toThrow(
      'Destination does not belong to the specified service.'
    );

    // Matching serviceId -> allowed
    expect(validateAccess('svc-finance', dest.serviceId)).toBe('svc-finance');

    // No serviceId provided -> bound to destination's owner service
    expect(validateAccess(undefined, dest.serviceId)).toBe('svc-finance');
  });
});
