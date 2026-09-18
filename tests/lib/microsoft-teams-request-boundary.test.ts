import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockTx = {
  incident: { findUnique: vi.fn() },
  microsoftTeamsConfig: { findFirst: vi.fn() },
  chatOpsConfig: { findUnique: vi.fn() },
  microsoftTeamsDestination: { findFirst: vi.fn() },
  chatIdentityLink: { findMany: vi.fn() },
  incidentWarRoom: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  backgroundJob: { create: vi.fn() },
};

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) =>
    fn(mockTx)
  ),
}));

vi.mock('@/lib/incident-collaboration/policy', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/incident-collaboration/policy')>();
  return {
    ...actual,
    getGlobalWarRoomPolicy: vi.fn().mockResolvedValue({
      enabled: true,
      defaultProviders: ['MICROSOFT_TEAMS'],
      defaultMeetingProvider: 'MICROSOFT_TEAMS',
      autoCreateOnUrgency: ['HIGH'],
      autoCreateOnPriority: ['P1', 'P2'],
      archiveOnResolve: true,
    }),
    getServiceWarRoomPolicy: vi.fn().mockResolvedValue(null),
  };
});

import { requestMicrosoftTeamsWarRoom } from '@/lib/war-room/providers/microsoft-teams/provision';

describe('requestMicrosoftTeamsWarRoom durable request boundary', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Unexpected network I/O in durable request transaction');
    });

    mockTx.incident.findUnique.mockResolvedValue({
      id: 'inc-1',
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      visibility: 'PUBLIC',
      serviceId: 'svc-1',
      service: {
        microsoftTeamsWarRoomAutoCreate: true,
        team: { teamLeadId: 'user-lead' },
      },
    });

    mockTx.microsoftTeamsConfig.findFirst.mockResolvedValue({
      id: 'cfg-1',
      enabled: true,
      warRoomsEnabled: true,
      tenantId: 'tenant-1',
      defaultMeetingOrganizerUpn: 'organizer@example.com',
      defaultWarRoomMembershipType: 'STANDARD',
    });

    mockTx.chatOpsConfig.findUnique.mockResolvedValue({
      id: 'default',
      enabled: true,
      autoCreateOnUrgency: ['HIGH'],
      autoCreateOnPriority: ['P1'],
    });

    mockTx.microsoftTeamsDestination.findFirst.mockResolvedValue({
      id: 'dest-1',
      enabled: true,
      warRoomEnabled: true,
      tenantId: 'tenant-1',
      teamId: 'team-1',
      installationId: 'inst-1',
      warRoomMembershipType: 'STANDARD',
    });

    mockTx.chatIdentityLink.findMany.mockResolvedValue([]);
    mockTx.incidentWarRoom.findFirst.mockResolvedValue(null);
    mockTx.incidentWarRoom.create.mockResolvedValue({
      id: 'room-1',
      provisioningToken: 'token-123',
      generation: 1,
    });
    mockTx.incidentWarRoom.updateMany.mockResolvedValue({ count: 1 });
    mockTx.backgroundJob.create.mockResolvedValue({ id: 'job-1' });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('performs zero external network I/O during war room request', async () => {
    const result = await requestMicrosoftTeamsWarRoom('inc-1', {
      manual: true,
      allowNewGeneration: true,
      membershipType: 'STANDARD',
    });

    expect(result).toMatchObject({ accepted: true, warRoomId: 'room-1' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockTx.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'WAR_ROOM_PROVISION',
        }),
      })
    );
  });

  it('performs zero external I/O for PRIVATE incident and provisions STANDARD channel open to team', async () => {
    mockTx.incident.findUnique.mockResolvedValue({
      id: 'inc-priv',
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      visibility: 'PRIVATE',
      serviceId: 'svc-1',
      service: {
        microsoftTeamsWarRoomAutoCreate: true,
        team: { teamLeadId: 'user-lead' },
      },
    });

    const result = await requestMicrosoftTeamsWarRoom('inc-priv', {
      manual: true,
      allowNewGeneration: true,
      membershipType: 'STANDARD',
    });

    expect(result).toMatchObject({ accepted: true, warRoomId: 'room-1' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockTx.incidentWarRoom.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          membershipType: 'STANDARD',
        }),
      })
    );
  });

  it('provisions standard war room without requiring private channel owner even if neither chat link nor organizer is configured', async () => {
    mockTx.incident.findUnique.mockResolvedValue({
      id: 'inc-priv',
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      visibility: 'PRIVATE',
      serviceId: 'svc-1',
      service: {
        microsoftTeamsWarRoomAutoCreate: true,
        team: { teamLeadId: 'user-lead' },
      },
    });

    mockTx.microsoftTeamsConfig.findFirst.mockResolvedValue({
      id: 'cfg-1',
      enabled: true,
      warRoomsEnabled: true,
      tenantId: 'tenant-1',
      defaultMeetingOrganizerUpn: null,
    });

    const result = await requestMicrosoftTeamsWarRoom('inc-priv', {
      manual: true,
      allowNewGeneration: true,
      membershipType: 'STANDARD',
    });

    expect(result).toMatchObject({ accepted: true, warRoomId: 'room-1' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockTx.backgroundJob.create).toHaveBeenCalled();
  });

  it('allows STANDARD war room on PRIVATE incident to ensure bot roster and public bridge availability', async () => {
    mockTx.incident.findUnique.mockResolvedValue({
      id: 'inc-priv',
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      visibility: 'PRIVATE',
      serviceId: 'svc-1',
      service: {
        microsoftTeamsWarRoomAutoCreate: true,
        team: { teamLeadId: 'user-lead' },
      },
    });

    mockTx.microsoftTeamsConfig.findFirst.mockResolvedValue({
      id: 'cfg-1',
      enabled: true,
      warRoomsEnabled: true,
      tenantId: 'tenant-1',
      defaultMeetingOrganizerUpn: null,
    });

    const result = await requestMicrosoftTeamsWarRoom('inc-priv', {
      manual: true,
      allowNewGeneration: true,
      membershipType: 'STANDARD',
    });

    expect(result).toMatchObject({ accepted: true, warRoomId: 'room-1' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
