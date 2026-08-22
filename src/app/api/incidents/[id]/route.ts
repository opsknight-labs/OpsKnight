import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey, hasApiScopes } from '@/lib/api-auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { checkRateLimit } from '@/lib/rate-limit';
import { IncidentPatchSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';

type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';
type IncidentUrgency = 'LOW' | 'MEDIUM' | 'HIGH';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

async function getApiUserContext(apiKeyUserId: string) {
  const user = await prisma.user.findUnique({
    where: { id: apiKeyUserId },
    select: {
      id: true,
      role: true,
      teamMemberships: { select: { teamId: true } },
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    role: user.role,
    teamIds: user.teamMemberships.map(membership => membership.teamId),
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return jsonError('Unauthorized. Missing or invalid API key.', 401);
  }
  if (!hasApiScopes(apiKey.scopes, ['incidents:read'])) {
    return jsonError('API key missing scope: incidents:read.', 403);
  }

  const rate = await checkRateLimit(
    `api:${apiKey.id}:incidents:get`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rate.allowed) {
    const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const apiUser = await getApiUserContext(apiKey.userId);
  if (!apiUser) {
    return jsonError('Unauthorized. API key user not found.', 401);
  }

  const { id } = await params;
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      service: { select: { id: true, name: true, teamId: true } },
      assignee: { select: { id: true, name: true, email: true } },
    },
  });

  if (!incident) {
    return jsonError('Incident not found.', 404);
  }

  if (apiUser.role !== 'ADMIN' && apiUser.role !== 'RESPONDER') {
    const teamId = incident.service?.teamId || null;
    const hasTeamMembership = teamId ? apiUser.teamIds.includes(teamId) : false;
    if (incident.assignee?.id !== apiUser.id && !hasTeamMembership) {
      return jsonError('Forbidden. Incident access denied.', 403);
    }
  }

  const responseIncident = incident.service
    ? { ...incident, service: { id: incident.service.id, name: incident.service.name } }
    : incident;

  return jsonOk({ incident: responseIncident }, 200);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return jsonError('Unauthorized. Missing or invalid API key.', 401);
  }
  if (!hasApiScopes(apiKey.scopes, ['incidents:write'])) {
    return jsonError('API key missing scope: incidents:write.', 403);
  }

  const rate = await checkRateLimit(
    `api:${apiKey.id}:incidents:patch`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rate.allowed) {
    const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const apiUser = await getApiUserContext(apiKey.userId);
  if (!apiUser) {
    return jsonError('Unauthorized. API key user not found.', 401);
  }

  let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = await req.json();
  } catch (_error) {
    return jsonError('Invalid JSON in request body.', 400);
  }
  const parsed = IncidentPatchSchema.safeParse({
    status: body.status,
    urgency: body.urgency,
    assigneeId: body.assigneeId ?? null,
  });
  if (!parsed.success) {
    return jsonError('Invalid request body.', 400, { issues: parsed.error.issues });
  }
  const { id } = await params;
  const currentIncident = await prisma.incident.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      urgency: true,
      acknowledgedAt: true,
      resolvedAt: true,
      assigneeId: true,
      service: { select: { teamId: true } },
    },
  });

  if (!currentIncident) {
    return jsonError('Incident not found.', 404);
  }

  if (apiUser.role !== 'ADMIN' && apiUser.role !== 'RESPONDER') {
    const teamId = currentIncident.service?.teamId || null;
    const hasTeamMembership = teamId ? apiUser.teamIds.includes(teamId) : false;
    if (currentIncident.assigneeId !== apiUser.id && !hasTeamMembership) {
      return jsonError('Forbidden. Incident access denied.', 403);
    }
  }
  const status: IncidentStatus | null = parsed.data.status ?? null;
  const urgency: IncidentUrgency | null = parsed.data.urgency ?? null;
  const assigneeId: string | null =
    typeof parsed.data.assigneeId === 'string' ? parsed.data.assigneeId : null;

  const updates: Record<string, unknown> = {};
  if (status) {
    const valid = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'].includes(status);
    if (!valid) {
      return jsonError('Invalid status.', 400);
    }
    updates.status = status;
    if (status === 'ACKNOWLEDGED' && !currentIncident.acknowledgedAt) {
      updates.acknowledgedAt = new Date();
    }
    if (status === 'RESOLVED' && !currentIncident.resolvedAt) {
      updates.resolvedAt = new Date();
    }
    if (status === 'ACKNOWLEDGED' || status === 'RESOLVED') {
      updates.escalationStatus = 'COMPLETED';
      updates.nextEscalationAt = null;
    } else if (status === 'SNOOZED' || status === 'SUPPRESSED') {
      updates.escalationStatus = 'PAUSED';
      updates.nextEscalationAt = null;
    } else if (
      status === 'OPEN' &&
      ['SNOOZED', 'SUPPRESSED', 'ACKNOWLEDGED', 'RESOLVED'].includes(currentIncident.status)
    ) {
      updates.escalationStatus = 'ESCALATING';
      if (currentIncident.status === 'ACKNOWLEDGED') {
        const policyData = await prisma.incident.findUnique({
          where: { id },
          select: {
            currentEscalationStep: true,
            service: {
              select: {
                policy: {
                  select: {
                    steps: {
                      orderBy: { stepOrder: 'asc' },
                      select: { delayMinutes: true },
                    },
                  },
                },
              },
            },
          },
        });
        const stepIndex = policyData?.currentEscalationStep ?? 0;
        const delayMinutes = policyData?.service?.policy?.steps?.[stepIndex]?.delayMinutes ?? 0;
        updates.nextEscalationAt = new Date(Date.now() + delayMinutes * 60 * 1000);
      } else {
        updates.nextEscalationAt = new Date();
      }
      if (currentIncident.status === 'ACKNOWLEDGED' || currentIncident.status === 'RESOLVED') {
        updates.acknowledgedAt = null;
      }
      if (currentIncident.status === 'RESOLVED') {
        updates.resolvedAt = null;
        updates.currentEscalationStep = 0;
      }
    }
  }
  if (urgency) {
    const valid = ['LOW', 'MEDIUM', 'HIGH'].includes(urgency);
    if (!valid) {
      return jsonError('Invalid urgency.', 400);
    }
    updates.urgency = urgency;
  }
  if (assigneeId !== null) {
    updates.assigneeId = assigneeId || null;
  }

  if (Object.keys(updates).length === 0) {
    return jsonError('No valid fields to update.', 400);
  }

  const incident = await prisma.incident.update({
    where: { id },
    data: updates,
  });

  logger.info('api.incident.updated', { incidentId: incident.id, apiKeyId: apiKey.id });

  if (status) {
    const eventMessage =
      status === 'SNOOZED'
        ? 'Incident snoozed (escalation paused)'
        : status === 'SUPPRESSED'
          ? 'Incident suppressed (escalation paused)'
          : status === 'OPEN' && currentIncident.status === 'ACKNOWLEDGED'
            ? 'Incident unacknowledged (escalation resumed)'
            : status === 'OPEN' &&
                (currentIncident.status === 'SNOOZED' || currentIncident.status === 'SUPPRESSED')
              ? 'Incident unsnoozed/unsuppressed (escalation resumed)'
              : `Status updated to ${status}${status === 'ACKNOWLEDGED' || status === 'RESOLVED' ? ' (escalation stopped)' : ''}`;

    await prisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        message: eventMessage,
      },
    });
  }

  if (urgency && urgency !== currentIncident.urgency) {
    await prisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        message: `Urgency updated to ${urgency}`,
      },
    });
  }

  if (assigneeId !== null && assigneeId !== currentIncident.assigneeId) {
    if (!assigneeId) {
      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          message: 'Incident unassigned',
        },
      });
    } else {
      const assignee = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { name: true },
      });
      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          message: `Incident manually reassigned to ${assignee?.name || 'user'}`,
        },
      });
    }
  }

  // If incident was reopened, ensure escalation is triggered if due
  if (
    status === 'OPEN' &&
    ['SNOOZED', 'SUPPRESSED', 'ACKNOWLEDGED', 'RESOLVED'].includes(currentIncident.status)
  ) {
    try {
      const { executeEscalation } = await import('@/lib/escalation');
      await executeEscalation(incident.id, 0);
    } catch (err) {
      logger.warn('[Incidents API] Failed to trigger escalation on reopen', {
        error: err,
        incidentId: incident.id,
      });
    }
  }

  // Trigger status page webhooks for incident updates
  try {
    const updatedIncident = await prisma.incident.findUnique({
      where: { id },
      include: {
        service: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    if (updatedIncident) {
      const { triggerWebhooksForService } = await import('@/lib/status-page-webhooks');
      let eventType = 'incident.updated';

      if (updatedIncident.status === 'RESOLVED') {
        eventType = 'incident.resolved';
      } else if (updatedIncident.status === 'ACKNOWLEDGED') {
        eventType = 'incident.acknowledged';
      } else if (updatedIncident.status === 'SNOOZED') {
        eventType = 'incident.snoozed';
      } else if (updatedIncident.status === 'SUPPRESSED') {
        eventType = 'incident.suppressed';
      }

      await triggerWebhooksForService(updatedIncident.serviceId, eventType, {
        id: updatedIncident.id,
        title: updatedIncident.title,
        description: updatedIncident.description,
        status: updatedIncident.status,
        urgency: updatedIncident.urgency,
        priority: updatedIncident.priority,
        service: {
          id: updatedIncident.service.id,
          name: updatedIncident.service.name,
        },
        assignee: updatedIncident.assignee,
        createdAt: updatedIncident.createdAt.toISOString(),
        acknowledgedAt: updatedIncident.acknowledgedAt?.toISOString() || null,
        resolvedAt: updatedIncident.resolvedAt?.toISOString() || null,
      });
    }
  } catch (e) {
    // Log but don't fail the request
    logger.error('api.incident.webhook_trigger_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Trigger service-level notifications (Slack, Webhooks)
  try {
    // Determine event type based on status change
    let eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated' = 'updated';
    if (status === 'ACKNOWLEDGED') eventType = 'acknowledged';
    else if (status === 'RESOLVED') eventType = 'resolved';
    // If status didn't change but we had an update, it's 'updated'

    const { sendServiceNotifications } = await import('@/lib/service-notifications');
    // Run in background
    sendServiceNotifications(incident.id, eventType).catch(err => {
      logger.error('api.incident.service_notification_failed', {
        error: err.message,
        incidentId: incident.id,
      });
    });
  } catch (e) {
    logger.error('api.incident.service_notification_import_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Notify status page subscribers (Email)
  try {
    let notifyEvent: 'acknowledged' | 'resolved' | 'investigating' | null = null;
    if (status === 'ACKNOWLEDGED') notifyEvent = 'acknowledged';
    else if (status === 'RESOLVED') notifyEvent = 'resolved';
    else if (status === 'OPEN') notifyEvent = 'investigating';

    if (notifyEvent) {
      const { notifyStatusPageSubscribers } = await import('@/lib/status-page-notifications');
      await notifyStatusPageSubscribers(incident.id, notifyEvent as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  } catch (e) {
    logger.error('api.incident.status_page_notification_failed', {
      error: e instanceof Error ? e.message : String(e),
      incidentId: incident.id,
    });
  }

  return jsonOk({ incident }, 200);
}
