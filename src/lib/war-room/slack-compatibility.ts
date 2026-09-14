import prisma from '@/lib/prisma';

const SLACK_ACTIVE_STATES = ['PROVISIONING', 'READY', 'CLOSING'] as const;

/**
 * Resolve Slack room authority from IncidentWarRoom. Legacy Incident columns
 * are deliberately not consulted here: they are a rolling-deploy projection,
 * never an input to new orchestration decisions.
 */
export async function findSlackWarRoomAuthority(
  incidentId: string,
  options: { activeOnly?: boolean } = {}
) {
  return prisma.incidentWarRoom.findFirst({
    where: {
      incidentId,
      provider: 'SLACK',
      ...(options.activeOnly ? { state: { in: [...SLACK_ACTIVE_STATES] } } : {}),
    },
    orderBy: { generation: 'desc' },
  });
}

/**
 * Maintain the old Incident fields for old binaries and UI readers during the
 * compatibility window. IncidentWarRoom is the sole source of truth.
 */
export async function projectSlackWarRoomToLegacyIncident(warRoomId: string): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId } });
  if (!room || room.provider !== 'SLACK') return;

  const isArchived = room.state === 'ARCHIVED' || room.state === 'CLOSED';
  const provisioningStatus =
    room.state === 'PROVISIONING'
      ? 'PROVISIONING'
      : room.state === 'FAILED' || room.state === 'AMBIGUOUS'
        ? 'FAILED'
        : 'READY';

  await prisma.incident.update({
    where: { id: room.incidentId },
    data: {
      slackWorkspaceId: room.providerTenantId,
      slackChannelId: room.providerChannelId,
      slackChannelName: room.providerChannelName,
      warRoomUrl: room.providerChannelUrl,
      warRoomArchivedAt: isArchived ? (room.archivedAt ?? room.closedAt ?? room.updatedAt) : null,
      warRoomProvisioningStatus: provisioningStatus,
      warRoomProvisioningToken: room.state === 'PROVISIONING' ? room.provisioningToken : null,
      warRoomProvisioningAt: room.state === 'PROVISIONING' ? room.provisioningStartedAt : null,
    },
  });
}
