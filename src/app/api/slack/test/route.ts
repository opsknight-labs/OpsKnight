import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import { assertAdminOrResponder, assertCanModifyService } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';
import { getSlackBotToken } from '@/lib/slack';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { integrationProviderError, jsonProviderError } from '@/lib/provider-errors';
import { getBaseUrl } from '@/lib/env-validation';
import { buildIncidentCard } from '@/lib/slack/incident-card';
import { describeSlackPostError } from '@/lib/slack/health';

function appBaseUrl(): string {
  try {
    return getBaseUrl().replace(/\/+$/, '');
  } catch {
    return 'http://localhost:3000';
  }
}

const testSchema = z.object({
  serviceId: z.string().trim().min(1).max(191).optional(),
  destinationId: z.string().trim().min(1).max(191).optional(),
  channelId: z.string().trim().min(1).max(255).optional(),
  channelName: z.string().trim().max(255).optional(),
});

/**
 * POST /api/slack/test
 * Send a test notification to a Slack channel
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }
    const parsed = testSchema.safeParse(body && typeof body === 'object' ? body : {});
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: parsed.error.issues[0]?.message ?? 'Invalid request body.',
        })
      );
    }

    const { destinationId } = parsed.data;
    let { serviceId, channelId, channelName } = parsed.data;

    if (destinationId) {
      const dest = await prisma.slackDestination.findUnique({
        where: { id: destinationId },
      });
      if (!dest) {
        return jsonError(
          new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Slack destination not found.' })
        );
      }
      if (serviceId && serviceId !== dest.serviceId) {
        return jsonError(
          new AppError({
            code: 'AUTHORIZATION_DENIED',
            userMessage: 'Destination does not belong to the specified service.',
          })
        );
      }
      serviceId = dest.serviceId;
      channelId = channelId || dest.channelId;
      channelName = (channelName || dest.channelName) ?? undefined;
    }

    const user = serviceId
      ? await assertCanModifyService(serviceId)
      : await assertAdminOrResponder();

    if (!channelId) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Channel ID is required.',
          fields: [{ field: 'channelId', code: 'required', message: 'Channel ID is required' }],
        })
      );
    }

    const botToken = await getSlackBotToken(serviceId || undefined);
    if (!botToken) {
      return jsonError(
        new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage: 'Slack is not configured.',
          action: 'Connect a Slack workspace before sending a test notification.',
          retryable: false,
          details: { provider: 'slack', reason: 'not_configured' },
        })
      );
    }

    // The real channel card (A1's builder) with sample data, so admins see what responders get.
    // Buttons are off: a sample has no incident for Acknowledge or Resolve to act on.
    const sample = buildIncidentCard(
      {
        id: 'sample',
        title: '[Test] Checkout API p95 latency above 2s',
        description: 'Sample incident sent from OpsKnight Settings to check this channel.',
        status: 'OPEN',
        urgency: 'HIGH',
        priority: 'P2',
        serviceName: 'Checkout API',
        createdAt: new Date(),
        assigneeName: user.name || user.email,
      },
      {
        appUrl: appBaseUrl(),
        interactive: false,
        note: `Test notification sent by ${user.name || user.email}. Real incident cards include Acknowledge and Resolve buttons.`,
      }
    );
    const testMessage = { channel: channelId, ...sample, unfurl_links: false };

    let response: Response;
    try {
      response = await retryFetch(
        'https://slack.com/api/chat.postMessage',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(testMessage),
        },
        { maxAttempts: 2, initialDelayMs: 500 }
      );
    } catch (error) {
      throw integrationProviderError({
        provider: 'slack',
        operation: 'chat.postMessage',
        cause: error,
      });
    }

    const data = await response.json();

    if (!data.ok) {
      const providerCode = typeof data.error === 'string' ? data.error : undefined;
      logger.warn('[Slack] Test notification failed', { error: providerCode, channelId });
      const providerError = integrationProviderError({
        provider: 'slack',
        operation: 'chat.postMessage',
        providerCode,
        status: response.status,
      });
      return jsonProviderError(providerError, {
        legacyError: describeSlackPostError(providerCode, channelName),
        provider: 'slack',
        providerCode,
      });
    }

    logger.info('[Slack] Test notification sent', { channelId, channelName, userId: user.id });

    return jsonOk({
      ok: true,
      message: `Test notification sent to #${channelName || channelId}`,
    });
  } catch (error) {
    logger.error('[Slack] Test notification error', {
      error,
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    });
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to send test notification', 500);
  }
}
