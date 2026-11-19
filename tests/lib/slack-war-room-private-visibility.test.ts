import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const tx = vi.hoisted(() => ({
  incident: { findUnique: vi.fn() },
  chatOpsConfig: { findUnique: vi.fn() },
  slackIntegration: { findFirst: vi.fn() },
  incidentWarRoom: { updateMany: vi.fn() },
  backgroundJob: { create: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ default: tx }));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: (cb: (t: unknown) => unknown) => cb(tx),
}));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn() }));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://example.test' }));
vi.mock('@/lib/war-room/slack-compatibility', () => ({
  projectSlackWarRoomToLegacyIncident: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/war-room/repository', () => ({
  adoptWarRoomChannel: vi.fn(),
  claimWarRoomProvisioning: vi.fn().mockResolvedValue({
    claimed: true,
    warRoom: { id: 'room-1', state: 'PROVISIONING', provisioningToken: 'tok-1' },
  }),
}));
vi.mock('@/lib/incident-collaboration/policy', () => ({
  getIncidentCollaborationPolicies: vi.fn().mockResolvedValue({ globalPolicy: {}, servicePolicy: {} }),
  resolveIncidentCollaborationPolicy: vi.fn().mockReturnValue({
    effectiveProviders: ['SLACK'],
    isCollaborationDisabled: false,
    shouldAutoCreate: true,
  }),
}));

import { requestSlackWarRoom } from '@/lib/war-room/providers/slack/provision';

function incident(visibility: 'PUBLIC' | 'PRIVATE') {
  return {
    status: 'OPEN',
    urgency: 'HIGH',
    priority: null,
    visibility,
    serviceId: 'svc-1',
    assigneeId: null,
    service: { id: 'svc-1', slackIntegration: { workspaceId: 'T1' } },
  };
}

describe('requestSlackWarRoom confidentiality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.chatOpsConfig.findUnique.mockResolvedValue({
      enabled: true,
      autoCreateOnUrgency: ['HIGH'],
      autoCreateOnPriority: [],
    });
    tx.slackIntegration.findFirst.mockResolvedValue(null);
    tx.incidentWarRoom.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each([
    ['PRIVATE', 'PRIVATE'],
    ['PUBLIC', 'STANDARD'],
  ] as const)('%s incident -> %s war room', async (visibility, expected) => {
    tx.incident.findUnique.mockResolvedValue(incident(visibility));
    const result = await requestSlackWarRoom('inc-1', { manual: true, allowNewGeneration: true });
    expect(result.accepted).toBe(true);
    expect(tx.incidentWarRoom.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ membershipType: expected }) })
    );
  });
});
