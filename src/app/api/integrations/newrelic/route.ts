import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { transformNewRelicToEvent, NewRelicEvent } from '@/lib/integrations/newrelic';

import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { withIntegrationMiddleware } from '@/lib/integrations/handler';
import { validatePayload, NewRelicEventSchema } from '@/lib/integrations/schemas';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
} from '@/lib/integrations/request-security';

/**
 * New Relic Webhook Endpoint
 * POST /api/integrations/newrelic?integrationId=xxx
 */
export async function POST(req: NextRequest) {
  return withIntegrationMiddleware(req, 'NEWRELIC', async () => {
    const startTime = Date.now();

    try {
      const { searchParams } = new URL(req.url);
      const integrationId = searchParams.get('integrationId');

      if (!integrationId) {
        return jsonError('integrationId is required', 400);
      }

      const integration = await prisma.integration.findUnique({
        where: { id: integrationId },
        include: { service: true },
      });

      if (!integration) {
        return jsonError('Integration not found', 404);
      }

      if (!integration.enabled) {
        return jsonError('Integration is disabled', 403);
      }

      let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        body = JSON.parse(await readIntegrationBody(req));
      } catch (_error) {
        return jsonError('Invalid JSON in request body.', 400);
      }

      const validation = validatePayload(NewRelicEventSchema, body);
      if (!validation.success) {
        logger.warn('api.integration.newrelic_validation_failed', {
          errors: validation.errors,
          integrationId,
        });
        return jsonError('Invalid New Relic webhook payload', 400, { errors: validation.errors });
      }

      const event = transformNewRelicToEvent(validation.data as NewRelicEvent);
      const result = await processEvent(event, integration.serviceId, integration.id);

      logger.info('api.integration.newrelic_success', {
        integrationId,
        action: result.action,
        latencyMs: Date.now() - startTime,
      });
      return jsonOk({ status: 'success', result }, 202);
    } catch (error: unknown) {
      if (error instanceof IntegrationBodyTooLargeError) return jsonError(error.message, 413);
      logger.error('api.integration.newrelic_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonError('Internal Server Error', 500);
    }
  });
}
