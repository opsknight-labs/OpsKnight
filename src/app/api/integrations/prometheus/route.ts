import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { transformPrometheusToEvent, PrometheusAlert } from '@/lib/integrations/prometheus';

import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { withIntegrationMiddleware } from '@/lib/integrations/handler';
import { validatePayload, PrometheusAlertSchema } from '@/lib/integrations/schemas';

/**
 * Prometheus Alertmanager Webhook Endpoint
 * POST /api/integrations/prometheus?integrationId=xxx
 */
export async function POST(req: NextRequest) {
  return withIntegrationMiddleware(req, 'PROMETHEUS', async () => {
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
        body = await req.json();
      } catch (_error) {
        return jsonError('Invalid JSON in request body.', 400);
      }

      const validation = validatePayload(PrometheusAlertSchema, body);
      if (!validation.success) {
        logger.warn('api.integration.prometheus_validation_failed', {
          errors: validation.errors,
          integrationId,
        });
        return jsonError('Invalid Prometheus Alertmanager payload', 400);
      }

      const events = transformPrometheusToEvent((validation.data || body) as PrometheusAlert);

      const results = [];
      for (const event of events) {
        results.push(await processEvent(event, integration.serviceId, integration.id));
      }

      logger.info('api.integration.prometheus_success', {
        integrationId,
        eventsProcessed: events.length,
        latencyMs: Date.now() - startTime,
      });
      return jsonOk({ status: 'success', results }, 202);
    } catch (error: unknown) {
      logger.error('api.integration.prometheus_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof ZodError || (error instanceof Error && error.message.includes('JSON'))) {
        return jsonError('Validation Error', 400);
      }
      return jsonError('Internal Server Error', 500);
    }
  });
}
