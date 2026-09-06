import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { transformPrometheusToEvent, PrometheusAlert } from '@/lib/integrations/prometheus';

import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { withIntegrationMiddleware } from '@/lib/integrations/handler';
import { validatePayload, PrometheusAlertSchema } from '@/lib/integrations/schemas';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
} from '@/lib/integrations/request-security';

const LEGACY_REQUIRED_MESSAGE = 'Please fill in all required fields.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

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
        return jsonError(
          new AppError({
            code: 'INTEGRATION_PAYLOAD_INVALID',
            userMessage: LEGACY_REQUIRED_MESSAGE,
            fields: [
              {
                field: 'integrationId',
                code: 'required',
                message: 'integrationId is required',
              },
            ],
          })
        );
      }

      const integration = await prisma.integration.findUnique({
        where: { id: integrationId },
        include: { service: true },
      });

      if (!integration) {
        return jsonError(
          new AppError({
            code: 'INTEGRATION_NOT_FOUND',
            userMessage: LEGACY_NOT_FOUND_MESSAGE,
            details: { integrationId },
          })
        );
      }

      if (!integration.enabled) {
        return jsonError(
          new AppError({
            code: 'INTEGRATION_DISABLED',
            userMessage: 'Integration is disabled',
            details: { integrationId },
          })
        );
      }

      let body: unknown;
      try {
        body = JSON.parse(await readIntegrationBody(req));
      } catch (error) {
        if (error instanceof IntegrationBodyTooLargeError) throw error;
        return jsonError(
          new AppError({
            code: 'INTEGRATION_PAYLOAD_INVALID',
            userMessage: LEGACY_INVALID_INPUT_MESSAGE,
          })
        );
      }

      const validation = validatePayload(PrometheusAlertSchema, body);
      if (!validation.success) {
        logger.warn('api.integration.prometheus_validation_failed', {
          errors: validation.errors,
          integrationId,
        });
        return jsonError(
          new AppError({
            code: 'INTEGRATION_VALIDATION_FAILED',
            userMessage: LEGACY_INVALID_INPUT_MESSAGE,
            details: { integrationId, errors: validation.errors },
          })
        );
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
      if (error instanceof IntegrationBodyTooLargeError) {
        return jsonError(
          new AppError({ code: 'PAYLOAD_TOO_LARGE', userMessage: error.message, cause: error })
        );
      }
      logger.error('api.integration.prometheus_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof ZodError) {
        return jsonError(
          new AppError({
            code: 'INTEGRATION_VALIDATION_FAILED',
            userMessage: 'Validation Error',
            cause: error,
          })
        );
      }
      return jsonError('Internal Server Error', 500);
    }
  });
}
