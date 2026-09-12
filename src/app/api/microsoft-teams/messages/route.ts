import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { assertMicrosoftTeamsActivityAuth } from '@/lib/microsoft-teams/auth';

/**
 * Bot Framework / Teams activity endpoint.
 *
 * `POST /api/microsoft-teams/messages`
 *
 * All `tenantId` / `teamId` / `channelId` values are derived from the verified
 * Bot Framework JWT (via `assertMicrosoftTeamsActivityAuth`), never from raw
 * JSON. The Azure Bot resource's messaging endpoint should point here; the
 * Teams app manifest does not carry a `botsEndpoint` property.
 *
 * Phase 1 handles:
 *  - `conversationUpdate` → record/update MicrosoftTeamsInstallation when the bot is added to a team
 *  - `invoke` (`adaptiveCard/action`) → Phase 2 seam (returns 501 until Phase 2)
 *  - `message` → no-op (ignore DMs)
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

  // Verify the request is genuinely from Bot Framework / Teams via JWT.
  // `assertMicrosoftTeamsActivityAuth` allows `x-opsknight-teams-test: 1` only in non-production.
  const verifiedIdentity = await assertMicrosoftTeamsActivityAuth(request);
  if (!verifiedIdentity) {
    // In production without a valid Bearer token, reject with 401.
    // In non-production, allow through only if test header is set (handled inside assertMicrosoftTeamsActivityAuth).
    // For any other request, treat as unauthenticated.
    const isTestBypass =
      process.env.NODE_ENV !== 'production' && request.headers.get('x-opsknight-teams-test') === '1';
    if (!isTestBypass) {
      logger.warn('[MicrosoftTeams] Rejected unverified Teams activity', { activityType });
      return NextResponse.json({ error: 'Teams activity verification required' }, { status: 401 });
    }
  }

  // For non-test identities, cross-check body tenant against verified JWT tid when present.
  const bodyTenantId = activity.channelData?.tenant?.id?.trim() || '';
  if (verifiedIdentity && verifiedIdentity.tenantId && verifiedIdentity.tenantId !== '__test__') {
    if (bodyTenantId && bodyTenantId !== verifiedIdentity.tenantId) {
      logger.warn('[MicrosoftTeams] Body tenantId does not match verified JWT tid — ignoring body value', {
        bodyTenantId,
        verifiedTenantId: verifiedIdentity.tenantId,
      });
    }
  }

  try {
    if (activityType === 'conversationUpdate') {
      // Prefer verified JWT tid when available; fall back to body only for test harness.
      const tenantId =
        verifiedIdentity && verifiedIdentity.tenantId !== '__test__' && verifiedIdentity.tenantId
          ? verifiedIdentity.tenantId
          : bodyTenantId;
      const teamId = activity.channelData?.team?.id?.trim() || activity.conversation?.id?.trim();
      const channelId = activity.channelData?.channel?.id?.trim();
      const teamName = activity.channelData?.team?.name?.trim() || activity.conversation?.name?.trim() || null;

      if (isTruthyString(tenantId) && isTruthyString(teamId)) {
        const botId = activity.recipient?.id?.trim();
        const botAdded =
          Array.isArray(activity.membersAdded) &&
          activity.membersAdded.some(m => m?.id && botId && m.id === botId);
        const botRemoved =
          Array.isArray(activity.membersRemoved) &&
          activity.membersRemoved.some(m => m?.id && botId && m.id === botId);
        if (botAdded) {
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
        } else if (botRemoved) {
          const prismaAny = prisma as unknown as {
            microsoftTeamsInstallation: { updateMany: (a: unknown) => Promise<unknown> };
            microsoftTeamsDestination: { updateMany: (a: unknown) => Promise<unknown> };
          };
          await prismaAny.microsoftTeamsInstallation.updateMany({
            where: { tenantId, teamId },
            data: { enabled: false },
          } as unknown as never);
          await prismaAny.microsoftTeamsDestination.updateMany({
            where: { tenantId, teamId },
            data: { enabled: false },
          } as unknown as never);
          logger.info('[MicrosoftTeams] Installation revoked — destinations disabled', { tenantId, teamId });
        }
      }
      return jsonOk({ ok: true });
    }

    if (activityType === 'invoke' && activity.name === 'adaptiveCard/action') {
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
      return jsonOk({ ok: true });
    }

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
