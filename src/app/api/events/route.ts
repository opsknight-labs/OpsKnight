import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { processEvent, EventPayload } from '@/lib/events';
import { authenticateApiKey, hasApiScopes } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { jsonError, jsonOk } from '@/lib/api-response';
import { EventSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

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

export async function POST(req: NextRequest) {
  try {
    // 1. Validate Integration Key or API Key
    const authHeader = req.headers.get('Authorization');
    let integrationId: string | null = null;
    let serviceId: string | null = null;
    let apiKeyScopes: string[] | null = null;
    let apiKeyUserId: string | null = null;
    let apiKeyId: string | null = null;

    if (authHeader?.startsWith('Token token=')) {
      const key = authHeader.split('Token token=')[1];
      const integration = await prisma.integration.findUnique({ where: { key } });
      if (!integration) {
        return jsonError('Invalid Integration Key', 403);
      }
      if (!integration.enabled) {
        return jsonError('Integration is disabled', 403);
      }
      integrationId = integration.id;
      serviceId = integration.serviceId;
    } else {
      const apiKey = await authenticateApiKey(req);
      if (!apiKey) {
        return jsonError('Unauthorized. Missing or invalid API key.', 401);
      }
      apiKeyScopes = apiKey.scopes;
      apiKeyUserId = apiKey.userId;
      apiKeyId = apiKey.id;
    }

    // 2. Parse Body
    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      body = await req.json();
    } catch (_error) {
      return jsonError('Invalid JSON in request body.', 400);
    }

    const parsed = EventSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid request body.', 400, { issues: parsed.error.issues });
    }
    const eventAction = parsed.data.event_action;
    const dedupKey = parsed.data.dedup_key;

    if (!serviceId) {
      if (!hasApiScopes(apiKeyScopes, ['events:write'])) {
        return jsonError('API key missing scope: events:write.', 403);
      }
      const candidate = body.service_id || body.serviceId;
      if (!candidate || typeof candidate !== 'string') {
        return jsonError('service_id is required when using API keys.', 400);
      }
      const service = await prisma.service.findUnique({ where: { id: candidate } });
      if (!service) {
        return jsonError('Service not found.', 404);
      }
      if (!apiKeyUserId) {
        return jsonError('Unauthorized. API key user not found.', 401);
      }
      const apiUser = await getApiUserContext(apiKeyUserId);
      if (!apiUser) {
        return jsonError('Unauthorized. API key user not found.', 401);
      }
      if (apiUser.role !== 'ADMIN' && apiUser.role !== 'RESPONDER') {
        if (!service.teamId || !apiUser.teamIds.includes(service.teamId)) {
          return jsonError('Forbidden. Service access denied.', 403);
        }
      }
      serviceId = service.id;
      integrationId = 'api-key';
    }

    const rateKey = integrationId
      ? `integration:${integrationId}:events`
      : apiKeyId
        ? `api:${apiKeyId}:events`
        : 'anonymous:events';
    const rate = await checkRateLimit(rateKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Rate limit exceeded.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    // 3. Process Event
    const result = await processEvent(
      { ...parsed.data, event_action: eventAction, dedup_key: dedupKey } as EventPayload,
      serviceId,
      integrationId || 'api-key'
    );

    logger.info('api.event.processed', { action: result.action, serviceId, integrationId });
    return jsonOk({ status: 'success', result }, 202);
  } catch (error: any) {
    logger.error('api.event.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Internal Server Error', 500);
  }
}
