import { NextRequest, NextResponse } from 'next/server';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import { logger } from '@/lib/logger';
import { verifySlackSignature } from '@/lib/slack-signature';

/**
 * Slack expects an acknowledgement in three seconds. Persisting the signed
 * request before returning makes that acknowledgement truthful: a worker owns
 * the mutation and independently retries the eventual response_url delivery.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-slack-signature') || '';
    const timestamp = request.headers.get('x-slack-request-timestamp') || '';
    const verification = await verifySlackSignature(body, signature, timestamp);
    if (!verification.valid) {
      logger.warn('[Slack] Rejected unverified slash command', { reason: verification.reason });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const params = new URLSearchParams(body);
    const payload = {
      __kind: 'SLASH_COMMAND',
      command: params.get('command') || '',
      text: params.get('text') || '',
      channel_id: params.get('channel_id') || '',
      channel_name: params.get('channel_name') || '',
      user_id: params.get('user_id') || '',
      user_name: params.get('user_name') || '',
      team_id: params.get('team_id') || '',
      response_url: params.get('response_url') || '',
    };
    if (!payload.team_id) return NextResponse.json({ error: 'Missing Slack workspace' }, { status: 400 });

    await enqueueChatOpsIntent({
      kind: 'SLASH_COMMAND',
      signature,
      workspaceId: payload.team_id,
      channelId: payload.channel_id,
      slackUserId: payload.user_id,
      payload,
    });
    return NextResponse.json({ response_type: 'ephemeral', text: '⚙️ Processing `/incident` command...' });
  } catch (error) {
    logger.error('[Slack] Commands API persistence error', { error });
    return NextResponse.json({ error: 'Unable to queue command' }, { status: 503 });
  }
}
