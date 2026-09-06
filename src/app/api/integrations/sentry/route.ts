import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { transformSentryToEvent, SentryEvent } from '@/lib/integrations/sentry';

import { verifySentrySignature } from '@/lib/integrations/signature-verification';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { decryptStoredSecret } from '@/lib/encryption';
import { withIntegrationMiddleware } from '@/lib/integrations/handler';
import { validatePayload, SentryEventSchema } from '@/lib/integrations/schemas';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
  claimInboundDelivery,
  completeInboundDelivery,
  failInboundDelivery,
  type InboundDeliveryClaim,
} from '@/lib/integrations/request-security';

const VERIFY_SIGNATURES = process.env.INTEGRATION_VERIFY_SIGNATURES !== 'false';

/**
 * Sentry Webhook Endpoint
 * POST /api/integrations/sentry?integrationId=xxx
 */
export async function POST(req: NextRequest) {
  return withIntegrationMiddleware(req, 'SENTRY', async () => {
  const startTime = Date.now();
  let deliveryClaim: Extract<InboundDeliveryClaim, { disposition: 'CLAIMED' }> | null = null;

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
      const sentrySignature = req.headers.get('sentry-hook-signature');
      const sentryTimestamp = req.headers.get('sentry-hook-timestamp');
      const sentryDeliveryId =
        req.headers.get('sentry-hook-id') ||
        (sentryTimestamp && sentrySignature ? `${sentryTimestamp}:${sentrySignature}` : null);

      if (VERIFY_SIGNATURES && integration.signatureSecret) {
        const signature = sentrySignature;
        if (!signature) {
          logger.warn('api.integration.sentry_missing_signature', { integrationId });
          return jsonError('Missing Sentry-Hook-Signature header', 401);
        }
        const signatureSecret = await decryptStoredSecret(integration.signatureSecret);
        if (!verifySentrySignature(rawBody, signature, signatureSecret)) {
          logger.warn('api.integration.sentry_invalid_signature', { integrationId });
          return jsonError('Invalid webhook signature', 401);
        }
        const claim = await claimInboundDelivery(integration.id, 'SENTRY', sentryDeliveryId);
        if (claim?.disposition === 'COMPLETED') return jsonOk({ status: 'duplicate' }, 200);
        if (claim?.disposition === 'BUSY') return jsonError('Webhook delivery is in progress', 503);
        if (claim?.disposition === 'CLAIMED') deliveryClaim = claim;
      }

      let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        body = JSON.parse(rawBody);
      } catch (_error) {
        return jsonError('Invalid JSON in request body.', 400);
      }

      const validation = validatePayload(SentryEventSchema, body);
      if (!validation.success) {
        logger.warn('api.integration.sentry_validation_failed', {
          errors: validation.errors,
          integrationId,
        });
        return jsonError('Invalid Sentry webhook payload', 400, { errors: validation.errors });
      }

      const event = transformSentryToEvent(validation.data as SentryEvent);
      const result = await processEvent(event, integration.serviceId, integration.id);
      if (deliveryClaim) await completeInboundDelivery(deliveryClaim);

      logger.info('api.integration.sentry_success', {
        integrationId,
        action: result.action,
        latencyMs: Date.now() - startTime,
      });
      return jsonOk({ status: 'success', result }, 202);
    } catch (error: unknown) {
      if (deliveryClaim) await failInboundDelivery(deliveryClaim, error).catch(() => undefined);
      if (error instanceof IntegrationBodyTooLargeError) {
        return jsonError(error.message, 413);
      }
      logger.error('api.integration.sentry_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonError('Internal Server Error', 500);
    }
  });
}
