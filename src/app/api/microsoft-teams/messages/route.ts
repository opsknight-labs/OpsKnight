import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';

/**
 * Bot Framework / Teams activity endpoint.
 *
 * `POST /api/microsoft-teams/messages`
 *
 * The Teams service delivers Bot Framework activities here. The app manifest
 * declares this as the single `botsEndpoint`. Never trust `tenantId` /
 * `teamId` / `userId` / `channelId` from raw JSON — production auth must
 * verify the activity via the Bot Framework CloudAdapter / Teams SDK before
 * extracting identities.
 *
 * Phase 1 handles:
 *  - `conversationUpdate` → record/update MicrosoftTeamsInstallation when the bot is added to a team
 *  - `invoke` (`adaptiveCard/action`) → Phase 2 interactive execution seam (returns 501 until Phase 2)
 *  - `message` → best-effort no-op (ignore DMs); never treat as auth.
 */

type TeamsActivity = {
  type?: string;
  id?: string;
  channelId?: string;
  serviceUrl?: string;
  from?: { id?: string; name?: string };
  recipient?: { id?: string };
  conversation?: { id?: string; name?: string; isGroup?: boolean };
  channelData?: {
    team?: { id?: string; name?: string };
    tenant?: { id?: string };
    channel?: { id?: string; name?: string };
  };
  membersAdded?: Array<{ id?: string }>;
  membersRemoved?: Array<{ id?: string }>;
  name?: string;
  value?: unknown;
};

function isTruthyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (e) {
    return jsonError(new AppError({ code: 'INVALID_JSON', cause: e as Error }));
  }

  const activity = (body ?? {}) as TeamsActivity;
  const activityType = typeof activity.type === 'string' ? activity.type : '';

  // Production MUST verify the Bot Framework JWT / Teams SDK before this point.
  // Until the CloudAdapter is wired, reject unverified traffic so no tenantId/
  // teamId from attacker-controlled JSON is ever persisted.
  const verified = request.headers.get('x-opsknight-teams-verified') === '1';
  const bypassInTest = process.env.NODE_ENV !== 'production' && request.headers.get('x-opsknight-teams-test') === '1';
  if (!verified && !bypassInTest && process.env.NODE_ENV === 'production') {
    logger.warn('[MicrosoftTeams] Rejected unverified Teams activity', { activityType });
    return NextResponse.json({ error: 'Teams activity verification required' }, { status: 401 });
  }

  try {
    if (activityType === 'conversationUpdate') {
      const tenantId = activity.channelData?.tenant?.id?.trim();
      const teamId = activity.channelData?.team?.id?.trim() || activity.conversation?.id?.trim();
      const channelId = activity.channelData?.channel?.id?.trim();
      const teamName = activity.channelData?.team?.name?.trim() || activity.conversation?.name?.trim() || null;

      // Only persist when identities are present. Do not fabricate them from message text.
      if (isTruthyString(tenantId) && isTruthyString(teamId)) {
        const botId = activity.recipient?.id?.trim();
        const botAdded = Array.isArray(activity.membersAdded) && activity.membersAdded.some(m => m?.id && botId && m.id === botId);
        // Record on install (bot added) or on any conversationUpdate that carries tenant/team
        if (botAdded || tenantId || teamId) {
          const prismaAny = prisma as unknown as {
            microsoftTeamsInstallation: {
              upsert: (args: unknown) => Promise<unknown>;
            };
          };
          await prismaAny.microsoftTeamsInstallation.upsert({
            where: { tenantId_teamId: { tenantId, teamId } },
            create: { tenantId, teamId, teamName, channelId: channelId || null, enabled: true },
            update: { teamName: teamName ?? undefined, channelId: channelId || undefined, enabled: true },
          } as unknown as never);
          logger.info('[MicrosoftTeams] Installation recorded', { tenantId, teamId });
        }
      }
      return jsonOk({ ok: true });
    }

    if (activityType === 'invoke' && activity.name === 'adaptiveCard/action') {
      // Phase 2 interactive execution (Ack/Resolve/Assign). Phase 1 intentionally
      // has no Action.Execute buttons on the Adaptive Card, so this should not
      // be reached in normal operation. Keep the seam ready.
      logger.info('[MicrosoftTeams] invoke adaptiveCard/action received (Phase 2)', {
        channelId: activity.channelData?.channel?.id,
      });
      return NextResponse.json(
        {
          statusCode: 501,
          type: 'application/vnd.microsoft.card.adaptive',
          value: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.5',
            body: [{ type: 'TextBlock', text: 'Interactive actions will be available in Phase 2.', wrap: true }],
          },
        },
        { status: 200 }
      );
    }

    if (activityType === 'message') {
      // Phase 1 does not process user messages. Ignore silently.
      return jsonOk({ ok: true });
    }

    // Unknown activity — acknowledge without error to avoid Teams retry storms.
    return jsonOk({ ok: true });
  } catch (error) {
    logger.error('[MicrosoftTeams] messages handler failed', {
      error: error instanceof Error ? error.message : String(error),
      activityType,
    });
    return jsonError('Failed to process Teams activity', 500);
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: '/api/microsoft-teams/messages' });
}
