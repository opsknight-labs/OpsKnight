import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  getGlobalWarRoomPolicy,
  getServiceWarRoomPolicy,
  getIncidentCollaborationPolicies,
  GLOBAL_WAR_ROOM_POLICY_KEY,
  GLOBAL_MEETING_POLICY_KEY,
  SERVICE_WAR_ROOM_POLICY_PREFIX,
} from '@/lib/incident-collaboration/policy';

const service = {
  id: 'service-a',
  autoCreateWarRoom: true,
  microsoftTeamsWarRoomAutoCreate: false,
  warRoomVideoBridge: 'JITSI',
};
const chatOps = {
  enabled: true,
  defaultVideoBridge: 'JITSI',
  autoCreateOnUrgency: ['HIGH'],
  autoCreateOnPriority: ['P1'],
  archiveOnResolve: true,
};
function fixture(values: Record<string, Prisma.JsonValue> = {}) {
  const client = {
    chatOpsConfig: { findUnique: vi.fn(async () => chatOps) },
    service: { findUnique: vi.fn(async () => service) },
    systemConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        where.key in values ? { value: values[where.key] } : null
      ),
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        Object.entries(values)
          .filter(([key]) => where.key.in.includes(key))
          .map(([key, value]) => ({ key, value }))
      ),
    },
  };
  return { client, tx: client as unknown as Prisma.TransactionClient, values };
}

describe('execution-time collaboration policy context', () => {
  it.each([
    {},
    { [GLOBAL_WAR_ROOM_POLICY_KEY]: ['SLACK'], [GLOBAL_MEETING_POLICY_KEY]: 'NONE' },
    {
      [`${SERVICE_WAR_ROOM_POLICY_PREFIX}service-a`]: {
        serviceProviders: null,
        meetingProvider: 'ZOOM',
        autoCreate: true,
        warRoomsEnabled: true,
      },
    },
    {
      [`${SERVICE_WAR_ROOM_POLICY_PREFIX}service-a`]: {
        serviceProviders: [],
        autoCreate: false,
        warRoomsEnabled: false,
      },
    },
    { [GLOBAL_WAR_ROOM_POLICY_KEY]: ['INVALID'], [GLOBAL_MEETING_POLICY_KEY]: 123 },
  ] as Record<string, Prisma.JsonValue>[])(
    'preserves canonical and legacy policy decoding: %j',
    async values => {
      const { client, tx } = fixture(values);
      const expected = {
        globalPolicy: await getGlobalWarRoomPolicy(tx),
        servicePolicy: await getServiceWarRoomPolicy(service.id, tx),
      };
      vi.clearAllMocks();
      expect(await getIncidentCollaborationPolicies(service, tx, chatOps)).toEqual(expected);
      expect(client.systemConfig.findMany).toHaveBeenCalledTimes(1);
      expect(client.systemConfig.findUnique).not.toHaveBeenCalled();
      expect(client.chatOpsConfig.findUnique).not.toHaveBeenCalled();
      expect(client.service.findUnique).not.toHaveBeenCalled();
    }
  );

  it('observes configuration enabled between executions without retaining a negative cache', async () => {
    const { tx, values } = fixture({
      [`${SERVICE_WAR_ROOM_POLICY_PREFIX}service-a`]: { warRoomsEnabled: false },
      // Another service must never affect this decision.
      [`${SERVICE_WAR_ROOM_POLICY_PREFIX}service-b`]: { warRoomsEnabled: true },
    });
    expect(
      (await getIncidentCollaborationPolicies(service, tx)).servicePolicy.warRoomsEnabled
    ).toBe(false);
    values[`${SERVICE_WAR_ROOM_POLICY_PREFIX}service-a`] = {
      warRoomsEnabled: true,
      autoCreate: true,
      serviceProviders: ['SLACK'],
    };
    const enabled = await getIncidentCollaborationPolicies(service, tx);
    expect(enabled.servicePolicy.warRoomsEnabled).toBe(true);
    expect(enabled.servicePolicy.serviceProviders).toEqual(['SLACK']);
  });

  it('propagates configuration failures so durable processing can retry', async () => {
    const { client, tx } = fixture();
    client.systemConfig.findMany.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(getIncidentCollaborationPolicies(service, tx)).rejects.toThrow(
      'database unavailable'
    );
  });

  it('propagates a failed global policy read and respects an explicitly absent snapshot', async () => {
    const { client, tx } = fixture();
    client.chatOpsConfig.findUnique.mockRejectedValueOnce(new Error('connection unavailable'));
    await expect(getIncidentCollaborationPolicies(service, tx)).rejects.toThrow(
      'connection unavailable'
    );
    vi.clearAllMocks();
    expect((await getIncidentCollaborationPolicies(service, tx, null)).globalPolicy.enabled).toBe(
      false
    );
    expect(client.chatOpsConfig.findUnique).not.toHaveBeenCalled();
  });
});
