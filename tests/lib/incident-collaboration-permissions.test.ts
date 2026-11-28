import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';

const mocks = vi.hoisted(() => ({ operatorPermissions: vi.fn(), userPermissions: vi.fn() }));

vi.mock('@/lib/rbac', () => ({
  getIncidentOperatorPermissions: mocks.operatorPermissions,
  getUserPermissions: mocks.userPermissions,
}));
vi.mock('@/lib/incident-collaboration/meeting-store', () => ({
  getIncidentMeeting: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/incident-collaboration/policy', () => ({
  getGlobalWarRoomPolicy: vi.fn().mockResolvedValue({ enabled: true, defaultProviders: ['SLACK'] }),
  getServiceWarRoomPolicy: vi.fn().mockResolvedValue(null),
  resolveIncidentCollaborationPolicy: vi.fn().mockReturnValue({
    desiredProviders: ['SLACK'],
    archiveOnResolve: false,
    privacyRequirement: 'STANDARD',
    meeting: { effectiveProvider: 'NONE', isDisabled: true, isUnavailable: false },
  }),
}));

import { getIncidentCollaborationView } from '@/lib/incident-collaboration/get-incident-collaboration';

const prismaMock = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe('incident collaboration permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.incident.findUnique.mockResolvedValue({
      id: 'inc-1',
      serviceId: 'svc-1',
      status: 'OPEN',
      urgency: 'HIGH',
      priority: null,
      visibility: 'PUBLIC',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      service: { slackIntegration: { id: 'slack-1', enabled: true, workspaceId: 'W1' } },
    });
    prismaMock.slackIntegration.findFirst.mockResolvedValue(null);
    prismaMock.microsoftTeamsConfig.findUnique.mockResolvedValue(null);
    prismaMock.microsoftTeamsDestination.findFirst.mockResolvedValue(null);
    prismaMock.incidentWarRoom.findMany.mockResolvedValue([]);
  });

  it('lets a USER-role assignee open a war room, the same decision assertCanManageWarRoom makes', async () => {
    // Scoped assignee: not a Responder (no OPERATIONS_MANAGE) but allowed to manage this incident.
    mocks.userPermissions.mockResolvedValue({ isResponderOrAbove: false });
    mocks.operatorPermissions.mockResolvedValue({ canManage: true });

    const view = await getIncidentCollaborationView({ incidentId: 'inc-1' });

    expect(mocks.operatorPermissions).toHaveBeenCalledWith('inc-1');
    expect(view.permissions).toEqual({ canManageWarRooms: true, canManageMeeting: true });
    expect(view.providers.find(p => p.provider === 'SLACK')?.canCreate).toBe(true);
  });

  it('keeps the controls hidden when the incident-scoped decision denies management', async () => {
    mocks.userPermissions.mockResolvedValue({ isResponderOrAbove: true });
    mocks.operatorPermissions.mockResolvedValue({ canManage: false });

    const view = await getIncidentCollaborationView({ incidentId: 'inc-1' });

    expect(view.permissions).toEqual({ canManageWarRooms: false, canManageMeeting: false });
    expect(view.providers.find(p => p.provider === 'SLACK')?.canCreate ?? false).toBe(false);
  });

  it('treats an unauthenticated viewer as unable to manage instead of throwing', async () => {
    mocks.operatorPermissions.mockRejectedValue(new Error('Unauthorized'));

    const view = await getIncidentCollaborationView({ incidentId: 'inc-1' });

    expect(view.permissions.canManageWarRooms).toBe(false);
  });
});
