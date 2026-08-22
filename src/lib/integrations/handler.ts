/**
 * Integration Handler Middleware
 *
 * Common middleware for all integration webhooks providing:
 * - Rate limiting
 * - Signature verification (optional)
 * - Payload validation
 * - Metrics recording
 * - Error handling
 */

import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { checkRateLimit, createRateLimitHeaders } from './rate-limiter';
import { verifyWebhookSignature, isTimestampValid } from './signature-verification';
import { recordWebhookReceived } from './metrics';
import { IntegrationErrors, isIntegrationError } from './errors';
import { validatePayload, IntegrationSchemas } from './schemas';
import { extractIntegrationKey, isIntegrationAuthorized } from './auth';
import type { z } from 'zod';

// Environment configuration
const VERIFY_SIGNATURES = process.env.INTEGRATION_VERIFY_SIGNATURES !== 'false';
const RATE_LIMIT_ENABLED = process.env.INTEGRATION_RATE_LIMIT !== 'false';

export interface IntegrationContext<T> {
  integration: {
    id: string;
    type: string;
    serviceId: string;
    enabled: boolean;
  };
  payload: T;
  rawPayload: string;
  headers: Record<string, string | null>;
  startTime: number;
}

export interface HandlerOptions<T> {
  /** Integration type for schema lookup */
  integrationType: keyof typeof IntegrationSchemas;

  /** Custom schema override (optional) */
  schema?: z.ZodSchema<T>;

  /** Provider for signature verification */
  signatureProvider?: 'github' | 'gitlab' | 'sentry' | 'slack' | 'grafana' | 'vercel' | 'generic';

  /** Skip rate limiting for this integration */
  skipRateLimit?: boolean;

  /** Skip signature verification for this integration */
  skipSignatureVerification?: boolean;

  /** Custom payload parser (for non-JSON formats) */
  parsePayload?: (body: string) => T;
}

/**
 * Create a standardized integration webhook handler
 */
export function createIntegrationHandler<T>(
  options: HandlerOptions<T>,
  processor: (ctx: IntegrationContext<T>) => Promise<{ action: string; incident?: unknown }>
) {
  return async function handler(req: NextRequest) {
    const startTime = performance.now();
    let integrationId: string | null = null;
    let integrationType: string = options.integrationType;

    try {
      // 1. Extract integration ID
      const { searchParams } = new URL(req.url);
      integrationId = searchParams.get('integrationId');

      if (!integrationId) {
        throw IntegrationErrors.invalidPayload('integrationId is required');
      }

      // 2. Rate limiting
      if (RATE_LIMIT_ENABLED && !options.skipRateLimit) {
        const rateResult = await checkRateLimit(integrationId);

        if (!rateResult.allowed) {
          const headers = createRateLimitHeaders(rateResult);
          recordWebhookReceived(
            integrationType,
            integrationId,
            false,
            performance.now() - startTime,
            'RATE_LIMITED'
          );

          return new Response(
            JSON.stringify({ error: 'RATE_LIMITED', message: 'Rate limit exceeded' }),
            {
              status: 429,
              headers: { 'Content-Type': 'application/json', ...headers },
            }
          );
        }
      }

      // 3. Lookup integration
      const integration = await prisma.integration.findUnique({
        where: { id: integrationId },
        select: {
          id: true,
          type: true,
          serviceId: true,
          enabled: true,
          signatureSecret: true,
          key: true,
        },
      });

      if (!integration) {
        throw IntegrationErrors.notFound(integrationId);
      }

      if (!integration.enabled) {
        throw IntegrationErrors.unauthorized('Integration is disabled');
      }

      if (!isIntegrationAuthorized(req, integration.key)) {
        throw IntegrationErrors.invalidPayload('Invalid integration key');
      }

      integrationType = integration.type;

      // 4. Get raw body for signature verification
      const rawPayload = await req.text();

      // 6. Collect headers for signature verification
      const headers: Record<string, string | null> = {
        'x-hub-signature-256': req.headers.get('x-hub-signature-256'),
        'x-gitlab-token': req.headers.get('x-gitlab-token'),
        'sentry-hook-signature': req.headers.get('sentry-hook-signature'),
        'x-slack-request-timestamp': req.headers.get('x-slack-request-timestamp'),
        'x-slack-signature': req.headers.get('x-slack-signature'),
        'x-grafana-signature': req.headers.get('x-grafana-signature'),
        'x-vercel-signature': req.headers.get('x-vercel-signature'),
        'x-signature': req.headers.get('x-signature'),
        'x-webhook-signature': req.headers.get('x-webhook-signature'),
      };

      // 7. Signature verification (if enabled and secret configured)
      if (VERIFY_SIGNATURES && !options.skipSignatureVerification && integration.signatureSecret) {
        const provider = options.signatureProvider || 'generic';
        const sigResult = verifyWebhookSignature(
          provider,
          rawPayload,
          headers,
          integration.signatureSecret
        );

        if (!sigResult.valid) {
          logger.warn('integration.signature_verification_failed', {
            integrationId,
            provider,
            error: sigResult.error,
          });

          if (sigResult.error === 'EXPIRED_TIMESTAMP') {
            throw IntegrationErrors.expiredTimestamp(300);
          } else if (sigResult.error === 'MISSING_SIGNATURE') {
            throw IntegrationErrors.missingSignature('Expected signature header');
          } else {
            throw IntegrationErrors.invalidSignature();
          }
        }
      }

      // 8. Parse JSON payload
      let body: unknown;
      try {
        if (options.parsePayload) {
          body = options.parsePayload(rawPayload);
        } else {
          body = JSON.parse(rawPayload);
        }
      } catch {
        throw IntegrationErrors.invalidPayload('Invalid JSON in request body');
      }

      // 9. Schema validation
      const schema = options.schema || IntegrationSchemas[options.integrationType];
      if (schema) {
        const validation = validatePayload(schema as any, body); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!validation.success) {
          throw IntegrationErrors.validationError(validation.errors);
        }
        body = validation.data;
      }

      // 10. Process the webhook
      const ctx: IntegrationContext<T> = {
        integration: {
          id: integration.id,
          type: integration.type,
          serviceId: integration.serviceId,
          enabled: integration.enabled,
        },
        payload: body as T,
        rawPayload,
        headers,
        startTime,
      };

      const result = await processor(ctx);

      // 11. Record success metrics
      recordWebhookReceived(integrationType, integrationId, true, performance.now() - startTime);

      return jsonOk({ status: 'success', result }, 202);
    } catch (error) {
      const latency = performance.now() - startTime;

      // Handle known integration errors
      if (isIntegrationError(error)) {
        if (integrationId) {
          recordWebhookReceived(integrationType, integrationId, false, latency, error.code);
        }

        logger.warn('integration.webhook_error', {
          integrationId,
          code: error.code,
          message: error.message,
        });

        return jsonError(error.message, error.statusCode);
      }

      // Handle unexpected errors
      logger.error('integration.webhook_unexpected_error', {
        integrationId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (integrationId) {
        recordWebhookReceived(integrationType, integrationId, false, latency, 'INTERNAL_ERROR');
      }

      return jsonError('Internal Server Error', 500);
    }
  };
}

/**
 * Industry-Standard Integration Middleware
 *
 * Security features (matching PagerDuty/OpsGenie):
 * - Integration key validation (URL param or header)
 * - Rate limiting per integration
 * - Metrics recording
 *
 * HMAC signature verification is handled in individual route handlers
 * for providers that support it (GitHub, Sentry, Grafana, Slack).
 */
export async function withIntegrationMiddleware(
  req: NextRequest,
  integrationType: string,
  handler: () => Promise<Response>
): Promise<Response> {
  const startTime = performance.now();
  const { searchParams } = new URL(req.url);
  const integrationId = searchParams.get('integrationId');

  // 1. Require integrationId
  if (!integrationId) {
    return jsonError('integrationId is required', 400);
  }

  // 2. Rate limiting
  if (RATE_LIMIT_ENABLED) {
    const rateResult = await checkRateLimit(integrationId);
    if (!rateResult.allowed) {
      recordWebhookReceived(
        integrationType,
        integrationId,
        false,
        performance.now() - startTime,
        'RATE_LIMITED'
      );
      return new Response(
        JSON.stringify({ error: 'RATE_LIMITED', message: 'Rate limit exceeded' }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...createRateLimitHeaders(rateResult) },
        }
      );
    }
  }

  // 3. Integration key validation (required - industry standard)
  // All webhook URLs include the key, so we always validate it
  // This provides baseline security for non-HMAC providers (Datadog, New Relic, etc.)
  // HMAC providers (GitHub, Sentry) get additional signature verification in route handlers
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { key: true, enabled: true },
  });

  if (!integration) {
    logger.warn('integration.not_found', { integrationId });
    recordWebhookReceived(
      integrationType,
      integrationId,
      false,
      performance.now() - startTime,
      'NOT_FOUND'
    );
    return jsonError('Integration not found', 404);
  }

  if (!integration.enabled) {
    logger.warn('integration.disabled', { integrationId });
    recordWebhookReceived(
      integrationType,
      integrationId,
      false,
      performance.now() - startTime,
      'DISABLED'
    );
    return jsonError('Integration is disabled', 403);
  }

  // Validate integration key (from URL param or header)
  if (!isIntegrationAuthorized(req, integration.key)) {
    logger.warn('integration.invalid_key', { integrationId });
    recordWebhookReceived(
      integrationType,
      integrationId,
      false,
      performance.now() - startTime,
      'UNAUTHORIZED'
    );
    return jsonError('Invalid integration key', 401);
  }

  try {
    const response = await handler();
    const success = response.status >= 200 && response.status < 300;
    recordWebhookReceived(integrationType, integrationId, success, performance.now() - startTime);
    return response;
  } catch (error) {
    logger.error('integration.handler_error', {
      integrationId,
      integrationType,
      error: error instanceof Error ? error.message : String(error),
    });
    recordWebhookReceived(
      integrationType,
      integrationId,
      false,
      performance.now() - startTime,
      'ERROR'
    );
    throw error;
  }
}
