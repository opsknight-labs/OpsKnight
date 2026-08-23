import { NextRequest, NextResponse } from 'next/server';
import { assertAdminOrResponder } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';
import { getSlackBotToken } from '@/lib/slack';

/**
 * POST /api/slack/test
 * Send a test notification to a Slack channel
 */
export async function POST(request: NextRequest) {
  try {
    const user = await assertAdminOrResponder();

    const body = await request.json();
    const channelId = typeof body?.channelId === 'string' ? body.channelId : null;
    const channelName = typeof body?.channelName === 'string' ? body.channelName : null;

    if (!channelId) {
      return NextResponse.json({ error: 'Channel ID is required' }, { status: 400 });
    }

    // Get bot token (global or env fallback)
    const botToken = await getSlackBotToken();

    if (!botToken) {
      return NextResponse.json(
        { error: 'Slack not configured. Connect Slack workspace first.' },
        { status: 503 }
      );
    }

    // Send test message
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

    const response = await retryFetch(
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

    const data = await response.json();

    if (!data.ok) {
      logger.warn('[Slack] Test notification failed', { error: data.error, channelId });

      const friendlyError =
        data.error === 'channel_not_found'
          ? 'Channel not found.'
          : data.error === 'not_in_channel'
            ? 'Bot is not a member of this channel.'
            : data.error === 'is_archived'
              ? 'Channel is archived.'
              : data.error === 'invalid_auth'
                ? 'Invalid Slack token. Reconnect workspace.'
                : `Slack error: ${data.error}`;

      return NextResponse.json({ error: friendlyError }, { status: 400 });
    }

    logger.info('[Slack] Test notification sent', { channelId, channelName, userId: user.id });

    return NextResponse.json({
      ok: true,
      message: `Test notification sent to #${channelName || channelId}`,
    });
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error('[Slack] Test notification error', { error: err.message });
    return NextResponse.json({ error: 'Failed to send test notification' }, { status: 500 });
  }
}
