import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanViewIncident, assertCanModifyIncident } from '@/lib/rbac';
import {
  getIncidentMeeting,
  provisionIncidentMeeting,
  requestMeetingProvision,
  closeIncidentMeeting,
} from '@/lib/incident-collaboration/meeting-store';
import {
  getGlobalWarRoomPolicy,
  getServiceWarRoomPolicy,
  resolveEffectiveMeetingProvider,
} from '@/lib/incident-collaboration/policy';
import type { IncidentMeetingProvider } from '@/lib/incident-collaboration/types';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: incidentId } = await context.params;
    await assertCanViewIncident(incidentId);

    const meeting = await getIncidentMeeting(incidentId);
    return jsonOk({ meeting });
  } catch (error) {
    return jsonError(
      isAppError(error)
        ? error
        : new AppError({
            code: 'INTERNAL_ERROR',
            userMessage: 'Unable to load incident meeting details.',
          })
    );
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: incidentId } = await context.params;
    await assertCanModifyIncident(incidentId);

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true,
        title: true,
        status: true,
        serviceId: true,
        service: {
          select: {
            warRoomCustomBridgeUrl: true,
            warRoomVideoBridge: true,
          },
        },
      },
    });

    if (!incident) {
      return jsonError(
        new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: 'Incident not found.',
        })
      );
    }

    let body: Record<string, unknown> | null = null;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // Body is optional if provisioning with defaults
    }

    const action = typeof body?.action === 'string' ? body.action : 'PROVISION';

    if (action === 'CLOSE') {
      await closeIncidentMeeting(incidentId);
      const updated = await getIncidentMeeting(incidentId);
      return jsonOk({ success: true, meeting: updated });
    }

    if (action === 'PROVISION' || action === 'RETRY') {
      const { getIncidentCollaborationCapabilities } =
        await import('@/lib/incident-collaboration/capabilities');
      const capabilities = await getIncidentCollaborationCapabilities({ incidentId });

      if (!capabilities.canManageMeeting) {
        return jsonError(
          new AppError({
            code: 'INCIDENT_MODIFY_DENIED',
            userMessage: 'You do not have permission to manage meeting bridges.',
          })
        );
      }

      const [globalPolicy, servicePolicy, teamsConfig] = await Promise.all([
        getGlobalWarRoomPolicy(),
        incident.serviceId ? getServiceWarRoomPolicy(incident.serviceId) : null,
        prisma.microsoftTeamsConfig.findUnique({
          where: { id: 'default' },
          select: { enabled: true, warRoomsEnabled: true },
        }),
      ]);

      const isTeamsAvailable = Boolean(teamsConfig?.enabled && teamsConfig?.warRoomsEnabled);

      const resolution = resolveEffectiveMeetingProvider({
        globalMeetingProvider: globalPolicy.defaultMeetingProvider,
        serviceMeetingProvider: servicePolicy ? (servicePolicy.meetingProvider ?? null) : null,
        isTeamsMeetingAvailable: isTeamsAvailable,
        globalWarRoomsEnabled: globalPolicy.enabled,
        serviceWarRoomsEnabled: servicePolicy ? servicePolicy.warRoomsEnabled : true,
      });

      if (resolution.isDisabled || resolution.effectiveProvider === 'NONE') {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'Meeting bridge is disabled for this service or organization.',
          })
        );
      }

      // If caller supplied a specific provider, ensure it is permitted (must match effective provider)
      const requestedProvider =
        typeof body?.provider === 'string'
          ? (body.provider as IncidentMeetingProvider)
          : resolution.effectiveProvider;

      if (requestedProvider !== resolution.effectiveProvider) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: `Provider ${requestedProvider} does not match the effective meeting policy (${resolution.effectiveProvider}).`,
          })
        );
      }

      if (resolution.isUnavailable && requestedProvider === 'MICROSOFT_TEAMS') {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage:
              resolution.unavailableReason ||
              'Microsoft Teams online meetings are not configured or lack Microsoft Graph permissions.',
          })
        );
      }

      const customTemplate = incident.service?.warRoomCustomBridgeUrl || null;

      const meeting = await requestMeetingProvision({
        incidentId,
        incidentTitle: incident.title,
        provider: requestedProvider,
        customTemplate,
        forceRetry: action === 'RETRY',
      });

      return jsonOk({ success: true, meeting });
    }

    return jsonError(
      new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: `Unknown meeting action: ${action}`,
      })
    );
  } catch (error) {
    return jsonError(
      isAppError(error)
        ? error
        : new AppError({
            code: 'INTERNAL_ERROR',
            userMessage: 'Failed to execute meeting action.',
          })
    );
  }
}
