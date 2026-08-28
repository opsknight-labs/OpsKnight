import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { jsonError, jsonOk } from '@/lib/api-response';
import { IncidentCreateSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { executeEscalation } from '@/lib/escalation';
import { scheduleStatusPageNotification } from '@/lib/jobs/queue';
import { resolveApiKeyActor } from '@/lib/authorization-actors';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { authorizationDecisionError } from '@/lib/api-authorization-error';
import { AppError } from '@/lib/errors';

const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

function parseLimit(value: string | null) {
  const limit = Number(value);
  if (Number.isNaN(limit) || limit <= 0) return 50;
  return Math.min(limit, 200);
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_BURST = 120;

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

export async function GET(req: NextRequest) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return jsonError(new AppError({ code: 'API_KEY_INVALID', userMessage: LEGACY_UNAUTHORIZED_MESSAGE }));
  }

  const rate = await checkRateLimit(`api:${apiKey.id}:incidents:get`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
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

  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get('limit'));
  const accessFilter = incidentReadWhere(actor);

  const incidents = await prisma.incident.findMany({
    where: accessFilter,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      service: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true, gender: true } },
    },
  });

  return jsonOk({ incidents }, 200, {
    'Cache-Control': 'private, max-age=5, stale-while-revalidate=15',
  });
}

export async function POST(req: NextRequest) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return jsonError(new AppError({ code: 'API_KEY_INVALID', userMessage: LEGACY_UNAUTHORIZED_MESSAGE }));
  }

  const rate = await checkRateLimit(`api:${apiKey.id}:incidents:post`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rate.allowed || rate.count > RATE_LIMIT_BURST) {
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

  const createDecision = authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_CREATE });
  if (!createDecision.allowed) {
    return jsonError(
      authorizationDecisionError(createDecision, {
        forbiddenMessage: 'Forbidden. Incident creation access denied.',
      })
    );
  }

  let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = await req.json();
  } catch (_error) {
    return jsonError(new AppError({ code: 'INVALID_JSON', userMessage: LEGACY_INVALID_INPUT_MESSAGE }));
  }

  const parsed = IncidentCreateSchema.safeParse({
    title: body.title,
    description: body.description ?? null,
    serviceId: body.serviceId,
    urgency: body.urgency,
    priority: body.priority ?? null,
  });

  if (!parsed.success) {
    return jsonError(
      new AppError({ code: 'VALIDATION_FAILED', userMessage: LEGACY_INVALID_INPUT_MESSAGE }),
      undefined,
      { issues: parsed.error.issues }
    );
  }

  const { title, description, serviceId, urgency, priority } = parsed.data;
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) {
    return jsonError(
      new AppError({
        code: 'SERVICE_NOT_FOUND',
        userMessage: LEGACY_NOT_FOUND_MESSAGE,
        details: { serviceId },
      })
    );
  }

  const serviceDecision = authorize({
    actor,
    action: AUTHORIZATION_ACTIONS.INCIDENT_CREATE,
    resource: { type: 'service', teamId: service.teamId },
  });
  if (!serviceDecision.allowed) {
    return jsonError(
      authorizationDecisionError(serviceDecision, {
        forbiddenCode: 'SERVICE_ACCESS_DENIED',
        forbiddenMessage: 'Forbidden. Service access denied.',
      })
    );
  }

  const incident = await prisma.incident.create({
    data: { title, description, urgency, priority, status: 'OPEN', serviceId },
    include: {
      service: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true, gender: true } },
    },
  });

  logger.info('api.incident.created', {
    incidentId: incident.id,
    serviceId: incident.serviceId,
    apiKeyId: apiKey.id,
  });

  let escalationResult: { escalated?: boolean; reason?: string } | null = null;
  try {
    escalationResult = await executeEscalation(incident.id);
  } catch (e) {
    logger.error('api.incident.escalation_failed', {
      error: e instanceof Error ? e.message : String(e),
      incidentId: incident.id,
    });
  }

  try {
    const { triggerWebhooksForService } = await import('@/lib/status-page-webhooks');
    await triggerWebhooksForService(incident.serviceId, 'incident.created', {
      id: incident.id,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      urgency: incident.urgency,
      priority: incident.priority,
      service: { id: incident.service.id, name: incident.service.name },
      assignee: incident.assignee,
      createdAt: incident.createdAt.toISOString(),
    });
  } catch (e) {
    logger.error('api.incident.webhook_trigger_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const hasEscalationPolicy = escalationResult?.reason !== 'No escalation policy configured';
  try {
    if (hasEscalationPolicy) {
      const { sendServiceNotifications } = await import('@/lib/service-notifications');
      await sendServiceNotifications(incident.id, 'triggered');
    } else {
      const { sendIncidentNotifications } = await import('@/lib/user-notifications');
      await sendIncidentNotifications(incident.id, 'triggered');
    }
  } catch (e) {
    logger.error('api.incident.service_notification_import_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    await scheduleStatusPageNotification(incident.id, 'triggered');
  } catch (e) {
    logger.error('api.incident.status_page_notification_enqueue_failed', {
      error: e instanceof Error ? e.message : String(e),
      incidentId: incident.id,
    });
  }

  try {
    const { createIncidentWarRoom } = await import('@/lib/chatops/war-room');
    await createIncidentWarRoom(incident.id);
  } catch (e) {
    logger.error('Failed to load chatops/war-room', { error: e });
  }

  return jsonOk({ incident }, 201);
}
