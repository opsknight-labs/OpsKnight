import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import { getGlobalWarRoomPolicy } from '@/lib/incident-collaboration/policy';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return jsonError('Authentication required', 401);
  }

  if (user.role !== 'ADMIN') {
    return jsonError('Admin access required', 403);
  }

  try {
    const [
      totalWarRooms,
      activeWarRooms,
      degradedWarRooms,
      totalMeetings,
      activeMeetings,
      degradedMeetings,
      cleanupDebtMeetings,
      globalPolicy,
      teamsConfig,
      slackIntegration,
    ] = await Promise.all([
      prisma.incidentWarRoom.count(),
      prisma.incidentWarRoom.count({
        where: { state: { in: ['READY', 'PROVISIONING', 'CLOSING'] } },
      }),
      prisma.incidentWarRoom.count({ where: { health: 'DEGRADED' } }),
      prisma.incidentMeeting.count(),
      prisma.incidentMeeting.count({
        where: { state: { in: ['READY', 'PROVISIONING', 'CLOSING'] } },
      }),
      prisma.incidentMeeting.count({ where: { health: 'DEGRADED' } }),
      prisma.incidentMeeting.count({ where: { externalCleanupPending: true } }),
      getGlobalWarRoomPolicy(),
      prisma.microsoftTeamsConfig.findUnique({
        where: { id: 'default' },
        select: { enabled: true, warRoomsEnabled: true, defaultMeetingOrganizerUpn: true },
      }),
      prisma.slackIntegration.findFirst({
        where: { enabled: true },
        select: { id: true, workspaceId: true, enabled: true },
      }),
    ]);

    return jsonOk(
      {
        warRooms: {
          total: totalWarRooms,
          active: activeWarRooms,
          degraded: degradedWarRooms,
        },
        meetings: {
          total: totalMeetings,
          active: activeMeetings,
          degraded: degradedMeetings,
          cleanupDebt: cleanupDebtMeetings,
        },
        providers: {
          teams: {
            configured: Boolean(teamsConfig?.enabled),
            warRoomsEnabled: Boolean(teamsConfig?.warRoomsEnabled),
            organizerUpnConfigured: Boolean(teamsConfig?.defaultMeetingOrganizerUpn),
          },
          slack: {
            configured: Boolean(slackIntegration?.enabled),
            workspaceId: slackIntegration?.workspaceId ?? null,
          },
        },
        policy: {
          globalProviders: globalPolicy.defaultProviders,
          warRoomsEnabled: globalPolicy.enabled,
          meetingProvider: globalPolicy.defaultMeetingProvider,
        },
      },
      200,
      { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
    );
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Unable to load collaboration operations status',
      500
    );
  }
}

export async function POST(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return jsonError('Authentication required', 401);
  }

  if (user.role !== 'ADMIN') {
    return jsonError('Admin access required', 403);
  }

  let body: { action?: string; meetingId?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  if (body.action !== 'retry_cleanup') {
    return jsonError('Unsupported action. Supported actions: retry_cleanup', 400);
  }

  if (!body.meetingId || typeof body.meetingId !== 'string') {
    return jsonError('meetingId is required', 400);
  }

  const { retryIncidentMeetingCleanup } =
    await import('@/lib/incident-collaboration/meeting-reconciliation');

  const result = await retryIncidentMeetingCleanup(body.meetingId.trim(), user.id);
  if (!result.success) {
    return jsonError(result.error || 'Failed to trigger cleanup retry', 400);
  }

  return jsonOk({ success: true, jobId: result.jobId, meetingId: body.meetingId.trim() }, 200, {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
  });
}
