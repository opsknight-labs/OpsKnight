import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey, hasApiScopes } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { jsonError, jsonOk } from '@/lib/api-response';
import { IncidentCreateSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { executeEscalation } from '@/lib/escalation';

function parseLimit(value: string | null) {
  const limit = Number(value);
  if (Number.isNaN(limit) || limit <= 0) return 50;
  return Math.min(limit, 200);
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_BURST = 120; // short burst protection

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

export async function GET(req: NextRequest) {
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

  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get('limit'));

  const accessFilter =
    apiUser.role === 'ADMIN' || apiUser.role === 'RESPONDER'
      ? undefined
      : {
          OR: [{ assigneeId: apiUser.id }, { service: { teamId: { in: apiUser.teamIds } } }],
        };

  const incidents = await prisma.incident.findMany({
    where: accessFilter,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      service: { select: { id: true, name: true } },
      assignee: {
        select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
      },
    },
  });

  // Add cache headers for incidents list (short cache, private)
  return jsonOk({ incidents }, 200, {
    'Cache-Control': 'private, max-age=5, stale-while-revalidate=15',
  });
}

export async function POST(req: NextRequest) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return jsonError('Unauthorized. Missing or invalid API key.', 401);
  }
  if (!hasApiScopes(apiKey.scopes, ['incidents:write'])) {
    return jsonError('API key missing scope: incidents:write.', 403);
  }

  const rate = await checkRateLimit(
    `api:${apiKey.id}:incidents:post`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  // Simple burst guard: if attempts exceed burst, block immediately
  if (!rate.allowed || rate.count > RATE_LIMIT_BURST) {
    const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }
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
  const parsed = IncidentCreateSchema.safeParse({
    title: body.title,
    description: body.description ?? null,
    serviceId: body.serviceId,
    urgency: body.urgency,
    priority: body.priority ?? null,
  });

  if (!parsed.success) {
    return jsonError('Invalid request body.', 400, { issues: parsed.error.issues });
  }

  const { title, description, serviceId, urgency, priority } = parsed.data;

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) {
    return jsonError('Service not found.', 404);
  }

  if (apiUser.role !== 'ADMIN' && apiUser.role !== 'RESPONDER') {
    if (!service.teamId || !apiUser.teamIds.includes(service.teamId)) {
      return jsonError('Forbidden. Service access denied.', 403);
    }
  }

  // Use include in create() to fetch relations in single query instead of separate findUnique
  const incident = await prisma.incident.create({
    data: {
      title,
      description,
      urgency,
      priority,
      status: 'OPEN',
      serviceId,
    },
    include: {
      service: { select: { id: true, name: true } },
      assignee: {
        select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
      },
    },
  });

  logger.info('api.incident.created', {
    incidentId: incident.id,
    serviceId: incident.serviceId,
    apiKeyId: apiKey.id,
  });

  // Execute escalation policy to assign/notify per policy steps
  let escalationResult: { escalated?: boolean; reason?: string } | null = null;
  try {
    escalationResult = await executeEscalation(incident.id);
  } catch (e) {
    logger.error('api.incident.escalation_failed', {
      error: e instanceof Error ? e.message : String(e),
      incidentId: incident.id,
    });
  }

  // Trigger status page webhooks for incident.created event
  try {
    const { triggerWebhooksForService } = await import('@/lib/status-page-webhooks');
    await triggerWebhooksForService(incident.serviceId, 'incident.created', {
      id: incident.id,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      urgency: incident.urgency,
      priority: incident.priority,
      service: {
        id: incident.service.id,
        name: incident.service.name,
      },
      assignee: incident.assignee,
      createdAt: incident.createdAt.toISOString(),
    });
  } catch (e) {
    // Log but don't fail the request
    logger.error('api.incident.webhook_trigger_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const hasEscalationPolicy = escalationResult?.reason !== 'No escalation policy configured';

  // Trigger service-level notifications (Slack, Webhooks),
  // or fall back to user notifications when no policy is configured.
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

  // Await delivery so serverless runtimes cannot terminate it with the request.
  try {
    const { notifyStatusPageSubscribers } = await import('@/lib/status-page-notifications');
    await notifyStatusPageSubscribers(incident.id, 'triggered');
  } catch (e) {
    logger.error('api.incident.status_page_notification_import_failed', {
      error: e instanceof Error ? e.message : String(e),
      incidentId: incident.id,
    });
  }

  // ChatOps: Auto-create war-room for qualifying incidents.
  try {
    const { createIncidentWarRoom } = await import('@/lib/chatops/war-room');
    await createIncidentWarRoom(incident.id);
  } catch (e) {
    logger.error('Failed to load chatops/war-room', { error: e });
  }

  return jsonOk({ incident }, 201);
}
