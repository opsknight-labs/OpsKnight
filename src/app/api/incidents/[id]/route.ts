import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { checkRateLimit } from '@/lib/rate-limit';
import { IncidentPatchSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { resolveApiKeyActor } from '@/lib/authorization-actors';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { authorizationDecisionError } from '@/lib/api-authorization-error';
import { AppError } from '@/lib/errors';
import { applyRestIncidentPatch } from '@/lib/incidents/rest-patch';

const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

function rateLimitError(retryAfter: number) {
  return jsonError(
    new AppError({
      code: 'RATE_LIMIT_EXCEEDED',
      userMessage: 'Rate limit exceeded.',
      details: { retryAfter },
    }),
    undefined,
    undefined,
    { 'Retry-After': String(retryAfter) }
  );
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return jsonError(
      new AppError({ code: 'API_KEY_INVALID', userMessage: LEGACY_UNAUTHORIZED_MESSAGE })
    );
  }

  const rate = await checkRateLimit(
    `api:${apiKey.id}:incidents:get`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rate.allowed) {
    return rateLimitError(Math.ceil((rate.resetAt - Date.now()) / 1000));
  }

  const actor = await resolveApiKeyActor(apiKey);
  if (!actor) {
    return jsonError(
      new AppError({
        code: 'API_KEY_USER_INVALID',
        userMessage: LEGACY_UNAUTHORIZED_MESSAGE,
        details: { apiKeyId: apiKey.id, userId: apiKey.userId },
      })
    );
  }

  const readDecision = authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_READ });
  if (!readDecision.allowed) {
    return jsonError(
      authorizationDecisionError(readDecision, {
        forbiddenMessage: 'Forbidden. Incident access denied.',
      })
    );
  }

  const { id } = await params;
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      service: { select: { id: true, name: true, teamId: true } },
      watchers: { select: { userId: true } },
      assignee: {
        select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
      },
    },
  });

  if (!incident) {
    return jsonError(
      new AppError({
        code: 'INCIDENT_NOT_FOUND',
        userMessage: LEGACY_NOT_FOUND_MESSAGE,
        details: { incidentId: id },
      })
    );
  }

  const decision = authorize({
    actor,
    action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
    resource: {
      type: 'incident',
      assigneeId: incident.assigneeId,
      watcherIds: incident.watchers.map(watcher => watcher.userId),
      visibility: incident.visibility,
      serviceTeamId: incident.service?.teamId,
      assignedTeamId: incident.teamId,
    },
  });
  if (!decision.allowed) {
    return jsonError(
      authorizationDecisionError(decision, {
        forbiddenCode: 'INCIDENT_ACCESS_DENIED',
        forbiddenMessage: 'Forbidden. Incident access denied.',
      })
    );
  }

  const { watchers: _watchers, ...visibleIncident } = incident;
  const responseIncident = visibleIncident.service
    ? {
        ...visibleIncident,
        service: { id: visibleIncident.service.id, name: visibleIncident.service.name },
      }
    : visibleIncident;

  return jsonOk({ incident: responseIncident }, 200);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return jsonError(
      new AppError({ code: 'API_KEY_INVALID', userMessage: LEGACY_UNAUTHORIZED_MESSAGE })
    );
  }

  const rate = await checkRateLimit(
    `api:${apiKey.id}:incidents:patch`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rate.allowed) {
    return rateLimitError(Math.ceil((rate.resetAt - Date.now()) / 1000));
  }

  const actor = await resolveApiKeyActor(apiKey);
  if (!actor) {
    return jsonError(
      new AppError({
        code: 'API_KEY_USER_INVALID',
        userMessage: LEGACY_UNAUTHORIZED_MESSAGE,
        details: { apiKeyId: apiKey.id, userId: apiKey.userId },
      })
    );
  }

  const manageDecision = authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE });
  if (!manageDecision.allowed) {
    return jsonError(
      authorizationDecisionError(manageDecision, {
        forbiddenMessage: 'Forbidden. API key owner cannot manage incidents.',
      })
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(
      new AppError({ code: 'INVALID_JSON', userMessage: LEGACY_INVALID_INPUT_MESSAGE })
    );
  }

  const parsed = IncidentPatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      new AppError({ code: 'VALIDATION_FAILED', userMessage: LEGACY_INVALID_INPUT_MESSAGE }),
      undefined,
      { issues: parsed.error.issues }
    );
  }

  const hasAssigneeUpdate =
    typeof body === 'object' &&
    body !== null &&
    Object.prototype.hasOwnProperty.call(body, 'assigneeId');
  if (parsed.data.status === undefined && parsed.data.urgency === undefined && !hasAssigneeUpdate) {
    return jsonError(
      new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'No valid fields to update.',
      })
    );
  }

  const { id } = await params;
  let result: Awaited<ReturnType<typeof applyRestIncidentPatch>>;
  try {
    result = await applyRestIncidentPatch({
      incidentId: id,
      status: parsed.data.status,
      urgency: parsed.data.urgency,
      assigneeId: hasAssigneeUpdate ? (parsed.data.assigneeId ?? null) : undefined,
      hasAssigneeUpdate,
      actor: { id: actor.id },
    });
  } catch (error) {
    logger.warn('api.incident.patch_rejected', {
      incidentId: id,
      apiKeyId: apiKey.id,
      error,
    });
    return jsonError(error);
  }

  const { incident, lifecycle, urgencyChanged, assigneeChanged } = result;
  logger.info('api.incident.updated', {
    incidentId: incident.id,
    apiKeyId: apiKey.id,
    changed: result.changed,
  });

  // Lifecycle effects are already persisted in the same transaction as the
  // status change. Keep the existing immediate path only for a pure
  // urgency/assignee update; a mixed PATCH emits the lifecycle event once.
  if (!lifecycle?.changed && (urgencyChanged || assigneeChanged)) {
    try {
      const updatedIncident = await prisma.incident.findUnique({
        where: { id },
        include: {
          service: { select: { id: true, name: true } },
          assignee: {
            select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
          },
        },
      });

      if (updatedIncident) {
        const { triggerWebhooksForService } = await import('@/lib/status-page-webhooks');
        await triggerWebhooksForService(updatedIncident.serviceId, 'incident.updated', {
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
    } catch (error) {
      logger.error('api.incident.webhook_trigger_failed', {
        error: error instanceof Error ? error.message : String(error),
        incidentId: id,
      });
    }

    try {
      const { sendServiceNotifications } = await import('@/lib/service-notifications');
      sendServiceNotifications(incident.id, 'updated').catch(error => {
        logger.error('api.incident.service_notification_failed', {
          error: error instanceof Error ? error.message : String(error),
          incidentId: incident.id,
        });
      });
    } catch (error) {
      logger.error('api.incident.service_notification_import_failed', {
        error: error instanceof Error ? error.message : String(error),
        incidentId: incident.id,
      });
    }
  }

  return jsonOk({ incident }, 200);
}
