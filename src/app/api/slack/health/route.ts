/**
 * GET /api/slack/health — admin-only live checklist for the Slack integration.
 * GET /api/slack/health?channelId=C123 — also checks whether the bot can post to that channel.
 *
 * Read only: it calls auth.test (and conversations.info on demand) and never changes anything.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { getSlackBotToken } from '@/lib/slack';
import { getSlackSigningSecret } from '@/lib/slack-signature';
import { isSquireChatOpsEnabled } from '@/lib/chatops/squire/switches';
import {
  buildSlackHealthReport,
  describeSlackPostError,
  type SlackAuthResult,
} from '@/lib/slack/health';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  channelId: z
    .string()
    .trim()
    .regex(/^[CG][A-Z0-9]{2,30}$/, 'Invalid Slack channel id')
    .optional(),
});

const SLACK_TIMEOUT_MS = 5_000;

async function slackGet(
  method: string,
  token: string,
  params: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
      cache: 'no-store',
    });
    // A health probe must answer quickly, so a 429 is reported, not waited out.
    if (response.status === 429) return { ok: false, error: 'ratelimited' };
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

export async function GET(request: NextRequest) {
  try {
    await assertAdmin();
    const parsed = querySchema.safeParse({
      channelId: request.nextUrl.searchParams.get('channelId') ?? undefined,
    });
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: parsed.error.issues[0]?.message ?? 'Invalid query.',
        })
      );
    }

    const [integration, signingSecret, lastIntent, squireChatEnabled, token] = await Promise.all([
      prisma.slackIntegration.findFirst({
        where: { enabled: true, services: { none: {} } },
        orderBy: { updatedAt: 'desc' },
        select: { workspaceId: true, workspaceName: true, scopes: true },
      }),
      getSlackSigningSecret(),
      // shortcut: unindexed sort on createdAt; fine while intents are pruned, add an index if the table grows.
      prisma.chatOpsIntent.findFirst({
        where: { provider: 'SLACK' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      isSquireChatOpsEnabled(),
      getSlackBotToken(),
    ]);

    let auth: SlackAuthResult = { ok: false, error: 'not_connected' };
    if (token) {
      const result = await slackGet('auth.test', token);
      auth = result.ok
        ? {
            ok: true,
            team: typeof result.team === 'string' ? result.team : null,
            teamId: typeof result.team_id === 'string' ? result.team_id : null,
            botUserId: typeof result.user_id === 'string' ? result.user_id : null,
          }
        : { ok: false, error: typeof result.error === 'string' ? result.error : 'unknown_error' };
    }

    const report = buildSlackHealthReport({
      auth,
      storedWorkspaceId: integration?.workspaceId,
      storedWorkspaceName: integration?.workspaceName,
      scopes: integration?.scopes ?? [],
      signingSecretConfigured: Boolean(signingSecret),
      lastInboundAt: lastIntent?.createdAt ?? null,
      squireChatEnabled,
    });

    let channel:
      | { id: string; name: string | null; reachable: boolean; detail: string }
      | undefined;
    if (parsed.data.channelId && token && auth.ok) {
      const info = await slackGet('conversations.info', token, {
        channel: parsed.data.channelId,
      });
      const data = (info.channel ?? {}) as Record<string, unknown>;
      const name = typeof data.name === 'string' ? data.name : null;
      const canPostPublicly =
        !data.is_private && (integration?.scopes ?? []).includes('chat:write.public');
      if (!info.ok) {
        const code = typeof info.error === 'string' ? info.error : null;
        channel = {
          id: parsed.data.channelId,
          name,
          reachable: false,
          detail: describeSlackPostError(code, name),
        };
      } else if (data.is_archived) {
        channel = {
          id: parsed.data.channelId,
          name,
          reachable: false,
          detail: describeSlackPostError('is_archived', name),
        };
      } else if (!data.is_member && !canPostPublicly) {
        channel = {
          id: parsed.data.channelId,
          name,
          reachable: false,
          detail: describeSlackPostError('not_in_channel', name),
        };
      } else {
        channel = {
          id: parsed.data.channelId,
          name,
          reachable: true,
          detail: data.is_member
            ? 'The bot is in this channel and can post.'
            : 'The bot can post here without joining (chat:write.public).',
        };
      }
    }

    return jsonOk({ ...report, workspaceName: integration?.workspaceName ?? null, channel });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('[Slack] Health check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to check Slack health', 500);
  }
}
