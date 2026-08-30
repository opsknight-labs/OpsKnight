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
import { AppError } from '@/lib/errors';
import { logger, withRequestContext } from '@/lib/logger';
import { checkRateLimit, createRateLimitHeaders } from './rate-limiter';
import { verifyWebhookSignature } from './signature-verification';
import { recordWebhookReceived } from './metrics';
import { IntegrationErrors, isIntegrationError } from './errors';
import { integrationErrorToAppError } from './app-error';
import { validatePayload, IntegrationSchemas } from './schemas';
import { isIntegrationAuthorized } from './auth';
import type { z } from 'zod';
import { decryptStoredSecret } from '@/lib/encryption';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
  rejectWebhookReplay,
} from './request-security';

const VERIFY_SIGNATURES = process.env.INTEGRATION_VERIFY_SIGNATURES !== 'false';
const RATE_LIMIT_ENABLED = process.env.INTEGRATION_RATE_LIMIT !== 'false';

const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';
const LEGACY_REQUIRED_MESSAGE = 'Please fill in all required fields.';

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
  integrationType: keyof typeof IntegrationSchemas;
  schema?: z.ZodSchema<T>;
  signatureProvider?: 'github' | 'gitlab' | 'sentry' | 'slack' | 'grafana' | 'vercel' | 'generic';
  skipRateLimit?: boolean;
  skipSignatureVerification?: boolean;
  parsePayload?: (body: string) => T;
}

export function createIntegrationHandler<T>(
  options: HandlerOptions<T>,
  processor: (ctx: IntegrationContext<T>) => Promise<{ action: string; incident?: unknown }>
) {
  const handler = async (req: NextRequest) => {
    const startTime = performance.now();
    let integrationId: string | null = null;
    let integrationType: string = options.integrationType;

    try {
      const { searchParams } = new URL(req.url);
      integrationId = searchParams.get('integrationId');

      if (!integrationId) {
        throw IntegrationErrors.invalidPayload('integrationId is required');
      }

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

      if (integration.type !== options.integrationType) {
        throw IntegrationErrors.unauthorized(
          `Integration type mismatch: expected ${options.integrationType}`
        );
      }

      if (!isIntegrationAuthorized(req, integration.key)) {
        throw IntegrationErrors.invalidPayload('Invalid integration key');
      }

      integrationType = integration.type;

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

          // Preserve the integration-specific wire contract for rate limits.
          return new Response(
            JSON.stringify({ error: 'RATE_LIMITED', message: 'Rate limit exceeded' }),
            {
              status: 429,
              headers: { 'Content-Type': 'application/json', ...headers },
            }
          );
        }
      }

      const rawPayload = await readIntegrationBody(req);

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

      if (VERIFY_SIGNATURES && !options.skipSignatureVerification && integration.signatureSecret) {
        const provider = options.signatureProvider || 'generic';
        const signatureSecret = await decryptStoredSecret(integration.signatureSecret);
        const sigResult = verifyWebhookSignature(provider, rawPayload, headers, signatureSecret);

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

        let deliveryId = req.headers.get('x-github-delivery') || req.headers.get('x-request-id');
        if (!deliveryId && provider === 'sentry') {
          const timestamp = req.headers.get('sentry-hook-timestamp');
          const signature = req.headers.get('sentry-hook-signature');
          if (timestamp && signature) deliveryId = `${timestamp}:${signature}`;
        }
        if (!deliveryId && provider === 'vercel') {
          try {
            const eventId = (JSON.parse(rawPayload) as { id?: unknown }).id;
            if (typeof eventId === 'string') deliveryId = eventId;
          } catch {
            // Payload parsing below returns the canonical invalid-payload error.
          }
        }
        if (await rejectWebhookReplay(integration.id, deliveryId)) {
          throw IntegrationErrors.invalidSignature({ reason: 'Duplicate webhook delivery' });
        }
      }

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

      const schema = options.schema || IntegrationSchemas[options.integrationType];
      if (schema) {
        const validation = validatePayload(schema as any, body); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!validation.success) {
          throw IntegrationErrors.validationError(validation.errors);
        }
        body = validation.data;
      }

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

      recordWebhookReceived(integrationType, integrationId, true, performance.now() - startTime);

      return jsonOk({ status: 'success', result }, 202);
    } catch (error) {
      if (error instanceof IntegrationBodyTooLargeError) {
        return jsonError(
          new AppError({
            code: 'PAYLOAD_TOO_LARGE',
            userMessage: error.message,
            cause: error,
          })
        );
      }
      const latency = performance.now() - startTime;

      if (isIntegrationError(error)) {
        if (integrationId) {
          recordWebhookReceived(integrationType, integrationId, false, latency, error.code);
        }

        logger.warn('integration.webhook_error', {
          integrationId,
          code: error.code,
          message: error.message,
        });

        const appError = integrationErrorToAppError(error);
        if (appError) return jsonError(appError);

        // Preserve legacy behavior for the internal/rate-limited variants that
        // have dedicated handling or should not expose new semantics here.
        return jsonError(error.message, error.statusCode);
      }

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

  return withRequestContext(handler, `api.integration.${options.integrationType}`);
}

export async function withIntegrationMiddleware(
  req: NextRequest,
  integrationType: string,
  handler: () => Promise<Response>
): Promise<Response> {
  const startTime = performance.now();
  const { searchParams } = new URL(req.url);
  const integrationId = searchParams.get('integrationId');

  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 1024 * 1024) {
    return jsonError(
      new AppError({
        code: 'PAYLOAD_TOO_LARGE',
        userMessage: 'Webhook body exceeds 1048576 bytes',
        details: { maxBytes: 1024 * 1024 },
      })
    );
  }

  if (!integrationId) {
    return jsonError(
      new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: LEGACY_REQUIRED_MESSAGE,
        fields: [
          { field: 'integrationId', code: 'required', message: 'integrationId is required' },
        ],
      })
    );
  }

  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { key: true, enabled: true, type: true },
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
    return jsonError(
      new AppError({
        code: 'INTEGRATION_NOT_FOUND',
        userMessage: LEGACY_NOT_FOUND_MESSAGE,
        details: { integrationId },
      })
    );
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
    return jsonError(
      new AppError({
        code: 'INTEGRATION_DISABLED',
        userMessage: 'Integration is disabled',
        details: { integrationId },
      })
    );
  }

  // A routing key is scoped to one configured provider. Without this check a
  // key for one integration could be submitted to a different provider route
  // and handled with that route's parser and signature policy.
  if (integration.type !== integrationType) {
    logger.warn('integration.type_mismatch', {
      integrationId,
      expectedType: integrationType,
      actualType: integration.type,
    });
    recordWebhookReceived(
      integrationType,
      integrationId,
      false,
      performance.now() - startTime,
      'UNAUTHORIZED'
    );
    return jsonError(
      new AppError({
        code: 'INTEGRATION_AUTHENTICATION_FAILED',
        userMessage: LEGACY_INVALID_INPUT_MESSAGE,
      })
    );
  }

  if (!isIntegrationAuthorized(req, integration.key)) {
    logger.warn('integration.invalid_key', { integrationId });
    recordWebhookReceived(
      integrationType,
      integrationId,
      false,
      performance.now() - startTime,
      'UNAUTHORIZED'
    );
    return jsonError(
      new AppError({
        code: 'INTEGRATION_AUTHENTICATION_FAILED',
        userMessage: LEGACY_INVALID_INPUT_MESSAGE,
        details: { integrationId },
      })
    );
  }

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

  try {
    const response = await handler();
    const success = response.status >= 200 && response.status < 300;
    recordWebhookReceived(integrationType, integrationId, success, performance.now() - startTime);
    return response;
  } catch (error) {
    if (error instanceof IntegrationBodyTooLargeError) {
      return jsonError(
        new AppError({
          code: 'PAYLOAD_TOO_LARGE',
          userMessage: error.message,
          cause: error,
        })
      );
    }
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
