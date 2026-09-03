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
  claimWebhookDelivery,
  completeWebhookDelivery,
  failWebhookDelivery,
  readIntegrationBody,
  webhookDeliveryResponse,
  type WebhookDeliveryClaim,
} from '@/lib/integrations/request-security';

const VERIFY_SIGNATURES = process.env.INTEGRATION_VERIFY_SIGNATURES !== 'false';

/** Sentry webhook endpoint. */
export async function POST(req: NextRequest) {
  return withIntegrationMiddleware(req, 'SENTRY', async () => {
    const startTime = Date.now();
    let deliveryClaim: WebhookDeliveryClaim = { tracked: false };

    try {
      const { searchParams } = new URL(req.url);
      const integrationId = searchParams.get('integrationId');
      if (!integrationId) return jsonError('integrationId is required', 400);

      const rawBody = await readIntegrationBody(req);
      const integration = await prisma.integration.findUnique({
        where: { id: integrationId },
        include: { service: true },
      });
      if (!integration) return jsonError('Integration not found', 404);
      if (!integration.enabled) return jsonError('Integration is disabled', 403);

      if (VERIFY_SIGNATURES && integration.signatureSecret) {
        const signature = req.headers.get('sentry-hook-signature');
        if (!signature) {
          logger.warn('api.integration.sentry_missing_signature', { integrationId });
          return jsonError('Missing Sentry-Hook-Signature header', 401);
        }
        const signatureSecret = await decryptStoredSecret(integration.signatureSecret);
        if (!verifySentrySignature(rawBody, signature, signatureSecret)) {
          logger.warn('api.integration.sentry_invalid_signature', { integrationId });
          return jsonError('Invalid webhook signature', 401);
        }
        const timestamp = req.headers.get('sentry-hook-timestamp');
        deliveryClaim = await claimWebhookDelivery(
          integration.id,
          'sentry',
          req.headers.get('sentry-hook-id') || (timestamp ? `${timestamp}:${signature}` : null)
        );
        const claimedResponse = webhookDeliveryResponse(deliveryClaim);
        if (claimedResponse) return claimedResponse;
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        await failWebhookDelivery(deliveryClaim, new Error('Invalid JSON payload'));
        return jsonError('Invalid JSON in request body.', 400);
      }

      const validation = validatePayload(SentryEventSchema, body);
      if (!validation.success) {
        await failWebhookDelivery(deliveryClaim, new Error('Invalid Sentry webhook payload'));
        logger.warn('api.integration.sentry_validation_failed', { errors: validation.errors, integrationId });
        return jsonError('Invalid Sentry webhook payload', 400, { errors: validation.errors });
      }

      const event = transformSentryToEvent(validation.data as SentryEvent);
      const result = await processEvent(event, integration.serviceId, integration.id);
      await completeWebhookDelivery(deliveryClaim);

      logger.info('api.integration.sentry_success', {
        integrationId,
        action: result.action,
        latencyMs: Date.now() - startTime,
      });
      return jsonOk({ status: 'success', result }, 202);
    } catch (error: unknown) {
      await failWebhookDelivery(deliveryClaim, error).catch(() => {});
      if (error instanceof IntegrationBodyTooLargeError) return jsonError(error.message, 413);
      logger.error('api.integration.sentry_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonError('Internal Server Error', 500);
    }
  });
}
