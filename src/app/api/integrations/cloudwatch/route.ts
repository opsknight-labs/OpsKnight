import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { transformCloudWatchToEvent, CloudWatchAlarmMessage } from '@/lib/integrations/cloudwatch';

import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { withIntegrationMiddleware } from '@/lib/integrations/handler';
import {
  validatePayload,
  CloudWatchAlarmSchema,
  SNSNotificationSchema,
} from '@/lib/integrations/schemas';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
} from '@/lib/integrations/request-security';

/**
 * AWS CloudWatch Webhook Endpoint
 * POST /api/integrations/cloudwatch?integrationId=xxx
 *
 * Features:
 * - Rate limiting (100 req/min per integration)
 * - Payload validation via Zod schemas
 * - Metrics tracking (success rate, latency)
 */
export async function POST(req: NextRequest) {
  return withIntegrationMiddleware(req, 'CLOUDWATCH', async () => {
    const startTime = Date.now();

    try {
      const { searchParams } = new URL(req.url);
      const integrationId = searchParams.get('integrationId');

      if (!integrationId) {
        return jsonError('integrationId is required', 400);
      }

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

      interface SNSMessage {
        Type?: string;
        SubscribeURL?: string;
        TopicArn?: string;
        Message?: string;
        AlarmName?: string;
      }

      // Parse request body
      let body: SNSMessage;
      try {
        body = JSON.parse(await readIntegrationBody(req)) as SNSMessage;
      } catch (_error) {
        return jsonError('Invalid JSON in request body.', 400);
      }

      // Handle SNS SubscriptionConfirmation (auto-confirm)
      if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
        logger.info('api.integration.cloudwatch_subscription_confirmation', {
          integrationId,
          topicArn: body.TopicArn,
        });

        // Automatically confirm the subscription by visiting the SubscribeURL
        // Automatically confirm the subscription by visiting the SubscribeURL
        try {
          // Strict SSRF protection: only allow well-formed AWS SNS HTTPS endpoints
          const validateSnsUrl = (urlString: string): string => {
            let url: URL;
            try {
              url = new URL(urlString);
            } catch {
              throw new Error('Invalid URL format');
            }

            if (url.protocol !== 'https:') {
              throw new Error('Protocol must be https');
            }

            const hostname = url.hostname.toLowerCase();
            // Match sns.<region>.amazonaws.com and sns.<region>.amazonaws.com.cn
            const snsHostPattern = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
            if (!snsHostPattern.test(hostname)) {
              throw new Error('Invalid SNS host');
            }

            // Return reconstructed string to break taint chain
            return `https://${hostname}${url.pathname}${url.search}`;
          };

          const safeUrlString = validateSnsUrl(body.SubscribeURL);

          // Log safety check pass
          logger.info('api.integration.cloudwatch_subscription_url_validated', {
            integrationId,
            host: new URL(safeUrlString).hostname,
          });

          const confirmResponse = await fetch(safeUrlString);
          if (confirmResponse.ok) {
            logger.info('api.integration.cloudwatch_subscription_confirmed', {
              integrationId,
              topicArn: body.TopicArn,
            });
            return jsonOk({ status: 'subscription_confirmed' }, 200);
          } else {
            logger.error('api.integration.cloudwatch_subscription_failed', {
              integrationId,
              status: confirmResponse.status,
            });
            return jsonError('Failed to confirm subscription', 500);
          }
        } catch (error) {
          logger.error('api.integration.cloudwatch_subscription_error', {
            integrationId,
            error: error instanceof Error ? error.message : String(error),
          });
          return jsonError('Failed to confirm subscription', 500);
        }
      }

      // Handle SNS format vs direct CloudWatch format
      let alarmMessage: CloudWatchAlarmMessage;

      if (body.Type === 'Notification' && body.Message) {
        // Validate SNS wrapper
        const snsValidation = validatePayload(SNSNotificationSchema, body);
        if (!snsValidation.success) {
          logger.warn('api.integration.cloudwatch_sns_validation_failed', {
            errors: snsValidation.errors,
            integrationId,
          });
        }

        // Parse and validate embedded CloudWatch message
        try {
          const parsedMessage = JSON.parse(body.Message);
          const messageValidation = validatePayload(CloudWatchAlarmSchema, parsedMessage);
          if (!messageValidation.success) {
            logger.warn('api.integration.cloudwatch_message_validation_failed', {
              errors: messageValidation.errors,
              integrationId,
            });
            return jsonError('Invalid CloudWatch message in SNS payload', 400);
          }
          alarmMessage = messageValidation.data;
        } catch {
          return jsonError('Invalid CloudWatch message in SNS payload', 400);
        }
      } else if (body.AlarmName) {
        // Direct CloudWatch format - validate
        const validation = validatePayload(CloudWatchAlarmSchema, body);
        if (!validation.success) {
          logger.warn('api.integration.cloudwatch_validation_failed', {
            errors: validation.errors,
            integrationId,
          });
          return jsonError('Invalid CloudWatch payload format', 400);
        }
        alarmMessage = validation.data;
      } else {
        return jsonError('Invalid CloudWatch payload format', 400);
      }

      // Transform to standard event format
      const event = transformCloudWatchToEvent(alarmMessage);

      // Process the event
      const result = await processEvent(event, integration.serviceId, integration.id);

      logger.info('api.integration.cloudwatch_success', {
        integrationId,
        action: result.action,
        latencyMs: Date.now() - startTime,
      });

      return jsonOk({ status: 'success', result }, 202);
    } catch (error: unknown) {
      if (error instanceof IntegrationBodyTooLargeError) return jsonError(error.message, 413);
      logger.error('api.integration.cloudwatch_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof ZodError || (error instanceof Error && error.message.includes('JSON'))) {
        return jsonError('Validation Error', 400);
      }
      return jsonError('Internal Server Error', 500);
    }
  });
}
