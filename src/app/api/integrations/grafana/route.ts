import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { transformGrafanaToEvents, GrafanaAlert } from '@/lib/integrations/grafana';

import { verifyGrafanaSignature } from '@/lib/integrations/signature-verification';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { withIntegrationMiddleware } from '@/lib/integrations/handler';
import { validatePayload, GrafanaAlertSchema } from '@/lib/integrations/schemas';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
  rejectWebhookReplay,
} from '@/lib/integrations/request-security';

const VERIFY_SIGNATURES = process.env.INTEGRATION_VERIFY_SIGNATURES !== 'false';

/**
 * Grafana Webhook Endpoint
 * POST /api/integrations/grafana?integrationId=xxx
 */
export async function POST(req: NextRequest) {
  return withIntegrationMiddleware(req, 'GRAFANA', async () => {
    const startTime = Date.now();

    try {
      const { searchParams } = new URL(req.url);
      const integrationId = searchParams.get('integrationId');

      if (!integrationId) {
        return jsonError('integrationId is required', 400);
      }

      const rawBody = await readIntegrationBody(req);

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

      if (VERIFY_SIGNATURES && integration.signatureSecret) {
        const signature = req.headers.get('x-grafana-signature');
        if (!signature) {
          logger.warn('api.integration.grafana_missing_signature', { integrationId });
          return jsonError('Missing X-Grafana-Signature header', 401);
        }
        if (!verifyGrafanaSignature(rawBody, signature, integration.signatureSecret)) {
          logger.warn('api.integration.grafana_invalid_signature', { integrationId });
          return jsonError('Invalid webhook signature', 401);
        }
        if (
          await rejectWebhookReplay(
            integration.id,
            req.headers.get('x-request-id') || req.headers.get('x-grafana-delivery')
          )
        ) {
          return jsonError('Duplicate webhook delivery', 409);
        }
      }

      let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        body = JSON.parse(rawBody);
      } catch (_error) {
        return jsonError('Invalid JSON in request body.', 400);
      }

      const validation = validatePayload(GrafanaAlertSchema, body);
      if (!validation.success) {
        logger.warn('api.integration.grafana_validation_failed', {
          errors: validation.errors,
          integrationId,
        });
        return jsonError('Invalid Grafana webhook payload', 400, { errors: validation.errors });
      }

      const events = transformGrafanaToEvents(validation.data as GrafanaAlert);
      const results = [];
      for (const event of events) {
        const result = await processEvent(event, integration.serviceId, integration.id);
        results.push(result);
      }

      const primaryResult = results[0] || { action: 'ignored' };

      logger.info('api.integration.grafana_success', {
        integrationId,
        action: primaryResult.action,
        count: results.length,
        latencyMs: Date.now() - startTime,
      });
      return jsonOk({ status: 'success', result: primaryResult, results }, 202);
    } catch (error: unknown) {
      if (error instanceof IntegrationBodyTooLargeError) {
        return jsonError(error.message, 413);
      }
      logger.error('api.integration.grafana_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonError('Internal Server Error', 500);
    }
  });
}
