import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { transformCloudWatchToEvent, CloudWatchAlarmMessage } from '@/lib/integrations/cloudwatch';

import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
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

const LEGACY_REQUIRED_MESSAGE = 'Please fill in all required fields.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

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

      // Verify integration exists and get service
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
      } catch (error) {
        if (error instanceof IntegrationBodyTooLargeError) throw error;
        return jsonError(
          new AppError({
            code: 'INTEGRATION_PAYLOAD_INVALID',
            userMessage: LEGACY_INVALID_INPUT_MESSAGE,
          })
        );
      }

      // Handle SNS SubscriptionConfirmation (auto-confirm)
      if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
        logger.info('api.integration.cloudwatch_subscription_confirmation', {
          integrationId,
          topicArn: body.TopicArn,
        });

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
            return jsonError(
              new AppError({
                code: 'INTEGRATION_VALIDATION_FAILED',
                userMessage: LEGACY_INVALID_INPUT_MESSAGE,
                details: { integrationId, errors: messageValidation.errors },
              })
            );
          }
          alarmMessage = messageValidation.data;
        } catch {
          return jsonError(
            new AppError({
              code: 'INTEGRATION_PAYLOAD_INVALID',
              userMessage: LEGACY_INVALID_INPUT_MESSAGE,
            })
          );
        }
      } else if (body.AlarmName) {
        // Direct CloudWatch format - validate
        const validation = validatePayload(CloudWatchAlarmSchema, body);
        if (!validation.success) {
          logger.warn('api.integration.cloudwatch_validation_failed', {
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
        alarmMessage = validation.data;
      } else {
        return jsonError(
          new AppError({
            code: 'INTEGRATION_PAYLOAD_INVALID',
            userMessage: LEGACY_INVALID_INPUT_MESSAGE,
          })
        );
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
      if (error instanceof IntegrationBodyTooLargeError) {
        return jsonError(
          new AppError({ code: 'PAYLOAD_TOO_LARGE', userMessage: error.message, cause: error })
        );
      }
      logger.error('api.integration.cloudwatch_error', {
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
