import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { transformGitHubToEvent, GitHubEvent } from '@/lib/integrations/github';

import { verifyGitHubSignature } from '@/lib/integrations/signature-verification';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { withIntegrationMiddleware } from '@/lib/integrations/handler';
import { validatePayload, GitHubEventSchema } from '@/lib/integrations/schemas';

const VERIFY_SIGNATURES = process.env.INTEGRATION_VERIFY_SIGNATURES !== 'false';

/**
 * GitHub/GitLab Webhook Endpoint
 * POST /api/integrations/github?integrationId=xxx
 *
 * Features:
 * - Rate limiting (100 req/min per integration)
 * - HMAC signature verification (X-Hub-Signature-256)
 * - Payload validation via Zod schemas
 * - Metrics tracking (success rate, latency)
 */
export async function POST(req: NextRequest) {
  return withIntegrationMiddleware(req, 'GITHUB', async () => {
    const startTime = Date.now();

    try {
      const { searchParams } = new URL(req.url);
      const integrationId = searchParams.get('integrationId');

      if (!integrationId) {
        return jsonError('integrationId is required', 400);
      }

      // Get raw body for signature verification
      const rawBody = await req.text();

      // Verify integration exists and get service
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

      // Verify GitHub signature if secret is configured
      if (VERIFY_SIGNATURES && integration.signatureSecret) {
        const signature = req.headers.get('x-hub-signature-256');
        if (!signature) {
          logger.warn('api.integration.github_missing_signature', { integrationId });
          return jsonError('Missing X-Hub-Signature-256 header', 401);
        }

        if (!verifyGitHubSignature(rawBody, signature, integration.signatureSecret)) {
          logger.warn('api.integration.github_invalid_signature', { integrationId });
          return jsonError('Invalid webhook signature', 401);
        }
      }

      let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        body = JSON.parse(rawBody);
      } catch (_error) {
        return jsonError('Invalid JSON in request body.', 400);
      }

      // Validate payload
      const validation = validatePayload(GitHubEventSchema, body);
      if (!validation.success) {
        logger.warn('api.integration.github_validation_failed', {
          errors: validation.errors,
          integrationId,
        });
        return jsonError('Invalid GitHub webhook payload', 400, { errors: validation.errors });
      }

      // Transform to standard event format
      const event = transformGitHubToEvent(validation.data as GitHubEvent);

      // Process the event
      const result = await processEvent(event, integration.serviceId, integration.id);

      logger.info('api.integration.github_success', {
        integrationId,
        action: result.action,
        latencyMs: Date.now() - startTime,
      });

      return jsonOk({ status: 'success', result }, 202);
    } catch (error: unknown) {
      logger.error('api.integration.github_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonError('Internal Server Error', 500);
    }
  });
}
