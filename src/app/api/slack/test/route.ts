import { NextRequest } from 'next/server';
import { assertAdminOrResponder, assertCanModifyService } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';
import { getSlackBotToken } from '@/lib/slack';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { integrationProviderError, jsonProviderError } from '@/lib/provider-errors';

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
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const channelId = typeof payload.channelId === 'string' ? payload.channelId : null;
    const channelName = typeof payload.channelName === 'string' ? payload.channelName : null;
    const serviceId = typeof payload.serviceId === 'string' ? payload.serviceId : null;

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

    const testMessage = {
      channel: channelId,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🧪 *Test Notification from OpsKnight*\n\nThis is a test message to verify the Slack integration is working correctly.`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Sent by ${user.name || user.email} • ${new Date().toLocaleString()}`,
            },
          ],
        },
      ],
    };

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
        legacyError: providerCode || 'Failed to send test notification',
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
