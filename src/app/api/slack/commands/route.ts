import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { verifySlackSignature } from '@/lib/slack-signature';
import { enqueueChatOpsIntent } from '@/lib/chatops/intent';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
} from '@/lib/integrations/request-security';

const MAX_SLACK_COMMAND_BYTES = 64 * 1024;
const MAX_SLACK_TEXT_LENGTH = 4_000;

export async function POST(request: NextRequest) {
  try {
    const body = await readIntegrationBody(request, MAX_SLACK_COMMAND_BYTES);
    const signature = request.headers.get('x-slack-signature') || '';
    const timestamp = request.headers.get('x-slack-request-timestamp') || '';

    const verification = await verifySlackSignature(body, signature, timestamp);
    if (!verification.valid) {
      logger.warn('[Slack] Rejected unverified slash command', { reason: verification.reason });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const params = new URLSearchParams(body);
    const text = params.get('text') || '';
    if (text.length > MAX_SLACK_TEXT_LENGTH) {
      return NextResponse.json(
        { response_type: 'ephemeral', text: '⚠️ Command text is too long.' },
        { status: 400 }
      );
    }

    const payload = {
      command: params.get('command') || '',
      text,
      channel_id: params.get('channel_id') || '',
      channel_name: params.get('channel_name') || '',
      user_id: params.get('user_id') || '',
      user_name: params.get('user_name') || '',
      team_id: params.get('team_id') || '',
      response_url: params.get('response_url') || '',
    };

    if (!payload.team_id || !payload.user_id || !payload.channel_id) {
      return NextResponse.json({ error: 'Missing Slack request identity' }, { status: 400 });
    }

    // Acknowledge Slack only after a durable, encrypted intent exists. The
    // deterministic signature/timestamp identity makes Slack retries idempotent
    // across replicas and process restarts.
    await enqueueChatOpsIntent({
      kind: 'SLASH_COMMAND',
      workspaceId: payload.team_id,
      requestIdentity: `${timestamp}:${signature}`,
      payload,
    });

    return NextResponse.json({
      response_type: 'ephemeral',
      text: '⚙️ Processing `/incident` command...',
    });
  } catch (error: unknown) {
    if (error instanceof IntegrationBodyTooLargeError) {
      return NextResponse.json({ error: 'Slack command payload too large' }, { status: 413 });
    }
    logger.error('[Slack] Commands API error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { response_type: 'ephemeral', text: 'An error occurred while accepting your command.' },
      { status: 500 }
    );
  }
}
