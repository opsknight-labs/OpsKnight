import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { processEvent, EventPayload } from '@/lib/events';
import { authenticateApiKey } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { jsonError, jsonOk } from '@/lib/api-response';
import { EventSchema } from '@/lib/validation';
import { logger, withRequestContext } from '@/lib/logger';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
} from '@/lib/integrations/request-security';
import { resolveApiKeyActor } from '@/lib/authorization-actors';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { authorizationDecisionError } from '@/lib/api-authorization-error';
import { AppError } from '@/lib/errors';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';
const LEGACY_REQUIRED_MESSAGE = 'Please fill in all required fields.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

async function postEvent(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    let integrationId: string | null = null;
    let serviceId: string | null = null;
    let apiKeyIdentity: Awaited<ReturnType<typeof authenticateApiKey>> = null;
    let apiKeyId: string | null = null;

    if (authHeader?.startsWith('Token token=')) {
      const key = authHeader.split('Token token=')[1];
      const integration = await prisma.integration.findUnique({ where: { key } });
      if (!integration) {
        return jsonError(new AppError({ code: 'INTEGRATION_KEY_INVALID', userMessage: LEGACY_INVALID_INPUT_MESSAGE }));
      }
      if (!integration.enabled) {
        return jsonError(
          new AppError({
            code: 'INTEGRATION_DISABLED',
            userMessage: 'Integration is disabled',
            details: { integrationId: integration.id },
          })
        );
      }
      // Routing keys are provider-scoped. Accepting a key generated for a
      // provider integration here would bypass that provider route's parser
      // and optional signature verification.
      if (integration.type !== 'EVENTS_API_V2') {
        return jsonError(
          new AppError({
            code: 'INTEGRATION_AUTHENTICATION_FAILED',
            userMessage: LEGACY_INVALID_INPUT_MESSAGE,
          })
        );
      }
      integrationId = integration.id;
      serviceId = integration.serviceId;
    } else {
      const apiKey = await authenticateApiKey(req);
      if (!apiKey) {
        return jsonError(new AppError({ code: 'API_KEY_INVALID', userMessage: LEGACY_UNAUTHORIZED_MESSAGE }));
      }
      apiKeyIdentity = apiKey;
      apiKeyId = apiKey.id;
    }

    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const rawBody = await readIntegrationBody(req);
      body = JSON.parse(rawBody);
    } catch (error) {
      if (error instanceof IntegrationBodyTooLargeError) {
        return jsonError(new AppError({ code: 'PAYLOAD_TOO_LARGE', userMessage: 'Payload too large.' }));
      }
      return jsonError(new AppError({ code: 'INVALID_JSON', userMessage: LEGACY_INVALID_INPUT_MESSAGE }));
    }

    const parsed = EventSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({ code: 'VALIDATION_FAILED', userMessage: LEGACY_INVALID_INPUT_MESSAGE }),
        undefined,
        { issues: parsed.error.issues }
      );
    }
    const eventAction = parsed.data.event_action;
    const dedupKey = parsed.data.dedup_key;

    if (!serviceId) {
      if (!apiKeyIdentity) {
        return jsonError(new AppError({ code: 'API_KEY_USER_INVALID', userMessage: LEGACY_UNAUTHORIZED_MESSAGE }));
      }
      const actor = await resolveApiKeyActor(apiKeyIdentity);
      if (!actor) {
        return jsonError(
          new AppError({
            code: 'API_KEY_USER_INVALID',
            userMessage: LEGACY_UNAUTHORIZED_MESSAGE,
            details: { apiKeyId: apiKeyIdentity.id, userId: apiKeyIdentity.userId },
          })
        );
      }

      const createDecision = authorize({ actor, action: AUTHORIZATION_ACTIONS.EVENT_CREATE });
      if (!createDecision.allowed) {
        return jsonError(
          authorizationDecisionError(createDecision, {
            forbiddenMessage: 'Forbidden. API key owner cannot create events.',
          })
        );
      }

      const candidate = body.service_id || body.serviceId;
      if (!candidate || typeof candidate !== 'string') {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: LEGACY_REQUIRED_MESSAGE,
            fields: [{ field: 'service_id', code: 'required', message: 'service_id is required when using API keys.' }],
          })
        );
      }
      const service = await prisma.service.findUnique({ where: { id: candidate } });
      if (!service) {
        return jsonError(
          new AppError({
            code: 'SERVICE_NOT_FOUND',
            userMessage: LEGACY_NOT_FOUND_MESSAGE,
            details: { serviceId: candidate },
          })
        );
      }

      const serviceDecision = authorize({
        actor,
        action: AUTHORIZATION_ACTIONS.EVENT_CREATE,
        resource: { type: 'service', teamId: service.teamId },
      });
      if (!serviceDecision.allowed) {
        return jsonError(
          authorizationDecisionError(serviceDecision, {
            forbiddenCode: 'SERVICE_ACCESS_DENIED',
            forbiddenMessage: 'Forbidden. API key owner cannot create events.',
          })
        );
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
      return jsonError(
        new AppError({ code: 'RATE_LIMIT_EXCEEDED', userMessage: 'Rate limit exceeded.', details: { retryAfter } }),
        undefined,
        undefined,
        { 'Retry-After': String(retryAfter) }
      );
    }

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

export const POST = withRequestContext(postEvent, 'api.events');
