'use server';

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';
import { decrypt } from '@/lib/encryption';

/**
 * POST /api/slack/channels/leave
 * Bot leaves a Slack channel
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const channelId = body?.channelId;

    if (!channelId) {
      return NextResponse.json({ error: 'Channel ID is required' }, { status: 400 });
    }

    // Get bot token
    const globalIntegration = await prisma.slackIntegration.findFirst({
      where: {
        enabled: true,
        services: { none: {} },
      },
    });

    if (!globalIntegration?.botToken) {
      return NextResponse.json({ error: 'Slack not configured.' }, { status: 503 });
    }

    let botToken: string;
    try {
      botToken = await decrypt(globalIntegration.botToken);
    } catch {
      return NextResponse.json({ error: 'Failed to decrypt Slack token.' }, { status: 500 });
    }

    // Leave channel
    const response = await retryFetch(
      'https://slack.com/api/conversations.leave',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: channelId }),
      },
      { maxAttempts: 2, initialDelayMs: 500 }
    );

    const data = await response.json();

    if (!data.ok) {
      logger.warn('[Slack] Failed to leave channel', { error: data.error, channelId });

      const friendlyError =
        data.error === 'channel_not_found'
          ? 'Channel not found.'
          : data.error === 'not_in_channel'
            ? 'Bot is not in this channel.'
            : data.error === 'is_archived'
              ? 'Channel is archived.'
              : data.error === 'cant_leave_general'
                ? 'Cannot leave the #general channel.'
                : `Slack error: ${data.error}`;

      return NextResponse.json({ error: friendlyError }, { status: 400 });
    }

    logger.info('[Slack] Bot left channel', { channelId, userId: user.id });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error('[Slack] Leave channel error', { error: err.message });
    return NextResponse.json({ error: 'Failed to leave channel' }, { status: 500 });
  }
}
