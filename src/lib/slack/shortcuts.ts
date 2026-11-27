import 'server-only';
/**
 * Slack shortcuts: "Declare incident from message" (message action) and "Declare incident" (global).
 * Both open the existing declare modal; the submission is handled by the unchanged declare handler.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { normalizeError } from '@/lib/errors';
import { callSlackApi } from '@/lib/slack/api';

export {
  DECLARE_FROM_MESSAGE_CALLBACK,
  DECLARE_GLOBAL_CALLBACK,
  SLACK_SHORTCUTS,
} from '@/lib/slack/shortcut-definitions';
import {
  DECLARE_FROM_MESSAGE_CALLBACK,
  DECLARE_GLOBAL_CALLBACK,
} from '@/lib/slack/shortcut-definitions';

type ShortcutPayload = {
  type?: unknown;
  callback_id?: unknown;
  trigger_id?: unknown;
  response_url?: unknown;
  team?: { id?: unknown };
  channel?: { id?: unknown };
  message?: { text?: unknown; ts?: unknown };
};
const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** First line of the message as the title (trimmed to 200), the rest kept in the description. */
export function prefillFromMessage(text: string, permalink?: string) {
  const clean = text.trim();
  const title = (clean.split('\n').find(line => line.trim()) ?? '').trim().slice(0, 200);
  const description = [clean, permalink ? `Source: ${permalink}` : '']
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 3000);
  return { title, description };
}

async function permalinkFor(
  token: string,
  channel: string,
  ts: string
): Promise<string | undefined> {
  if (!channel || !ts) return undefined;
  // Cheap or skipped: it shares Slack's three-second trigger_id budget with the services query.
  const result = await callSlackApi<{ permalink?: string }>(
    'chat.getPermalink',
    token,
    { channel, message_ts: ts },
    { timeoutMs: 1_200, form: true }
  ).catch(() => null);
  return result?.ok && typeof result.data.permalink === 'string'
    ? result.data.permalink
    : undefined;
}

/** Always answers 200 (Slack ignores shortcut response bodies); a failure is logged and, for message actions, whispered. */
export async function handleSlackShortcut(payload: ShortcutPayload): Promise<Response> {
  const ok = () => new Response(null, { status: 200 });
  const callback = str(payload.callback_id);
  const teamId = str(payload.team?.id);
  const triggerId = str(payload.trigger_id);
  const isMessage = payload.type === 'message_action' && callback === DECLARE_FROM_MESSAGE_CALLBACK;
  const isGlobal = payload.type === 'shortcut' && callback === DECLARE_GLOBAL_CALLBACK;
  if ((!isMessage && !isGlobal) || !teamId || !triggerId) return ok();
  const responseUrl = str(payload.response_url) || undefined;
  const whisper = async (text: string) => {
    if (!isMessage || !responseUrl) return;
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }),
      signal: AbortSignal.timeout(2_000),
    }).catch(() => undefined);
  };
  try {
    const { workspaceBotToken, buildSlackDeclareModal } =
      await import('@/lib/chatops/slash-commands');
    const channelId = str(payload.channel?.id);
    const ts = str(payload.message?.ts);
    const [token, services] = await Promise.all([
      workspaceBotToken(teamId),
      prisma.service.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 100,
      }),
    ]);
    if (!token) return (await whisper('⚠️ Could not open the declare form.'), ok());
    if (services.length === 0)
      return (await whisper('ℹ️ Create a service in OpsKnight first.'), ok());
    const view = buildSlackDeclareModal({
      services,
      ...(isMessage && responseUrl ? { responseUrl } : {}),
      ...(channelId ? { channelId } : {}),
    }) as ReturnType<typeof buildSlackDeclareModal> & { blocks: Array<Record<string, any>> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (isMessage) {
      const permalink = await permalinkFor(token, channelId, ts);
      const { title, description } = prefillFromMessage(str(payload.message?.text), permalink);
      for (const block of view.blocks) {
        if (block.block_id === 'declare_title' && title) block.element.initial_value = title;
        if (block.block_id === 'declare_description' && description)
          block.element.initial_value = description;
      }
      // The declare handler keeps only what it knows; the source message ts rides along for the record.
      const metadata = JSON.stringify({
        ...JSON.parse((view as { private_metadata?: string }).private_metadata ?? '{}'),
        sourceTs: ts,
      });
      if (metadata.length <= 3000)
        (view as { private_metadata?: string }).private_metadata = metadata;
    }
    const result = await callSlackApi(
      'views.open',
      token,
      { trigger_id: triggerId, view },
      { timeoutMs: 2_000 }
    );
    if (!result.ok) {
      logger.warn('[SlackOps] Shortcut modal did not open', { callback, error: result.error });
      await whisper('⚠️ Could not open the declare form. Try again.');
    }
  } catch (error) {
    logger.warn('[SlackOps] Shortcut failed', { callback, error: normalizeError(error).code });
    await whisper('⚠️ Could not open the declare form. Try again.');
  }
  return ok();
}
