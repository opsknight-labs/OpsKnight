import { after, NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { handleSlashCommand } from '@/lib/chatops/slash-commands';
import { verifySlackSignature, toSlackResponseUrl } from '@/lib/slack-signature';

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
      command: params.get('command') || '',
      text: params.get('text') || '',
      channel_id: params.get('channel_id') || '',
      channel_name: params.get('channel_name') || '',
      user_id: params.get('user_id') || '',
      user_name: params.get('user_name') || '',
      team_id: params.get('team_id') || '',
      response_url: params.get('response_url') || '',
    };

    const handlePromise = handleSlashCommand(payload);
    const timeoutPromise = new Promise<{ timeout: true }>(resolve =>
      setTimeout(() => resolve({ timeout: true }), 1500)
    );

    const raceResult = await Promise.race([handlePromise, timeoutPromise]);

    if ('timeout' in raceResult && raceResult.timeout) {
      // Processing taking longer than 1.5s -> finish in background and post to response_url
      // Rebuilt against a literal origin, so this can only ever reach Slack
      const responseUrl = toSlackResponseUrl(payload.response_url);
      after(async () => {
        try {
          const result = await handlePromise;
          // Attacker-controlled input — only ever POST back to Slack's own host
          if (responseUrl && result) {
            try {
              await fetch(responseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
              });
            } catch (err) {
              logger.error('[Slack] Failed to post async command response to response_url', {
                error: err,
              });
            }
          }
        } catch (err) {
          logger.error('[Slack] Error in async slash command processing', { error: err });
        }
      });

      // Return immediate HTTP 200 to Slack within 1.5s to prevent 3000ms operation_timeout
      return NextResponse.json({
        response_type: 'ephemeral',
        text: '⚙️ Processing `/incident` command...',
      });
    }

    return NextResponse.json(await handlePromise);
  } catch (error: any) {
    logger.error('[Slack] Commands API error', {
      error: error.message,
      stack: error.stack,
    });

    return NextResponse.json({
      response_type: 'ephemeral',
      text: 'An error occurred while processing your command.',
    });
  }
}
