import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { emitAuditEvent } from '@/lib/audit';
import {
  assertMicrosoftTeamsActivityAuth,
  enforceMicrosoftTeamsTenantAllowlist,
  getMicrosoftTeamsConfig,
} from '@/lib/microsoft-teams/auth';
import { normalizeTrustedMicrosoftTeamsServiceUrl } from '@/lib/microsoft-teams/service-url';
import {
  revokeMicrosoftTeamsOperations,
  revokeMicrosoftTeamsWarRoomProvisioning,
  TEAMS_REVOCATION_TX_OPTIONS,
} from '@/lib/microsoft-teams/lifecycle';

/**
 * Bot Framework / Teams activity endpoint.
 *
 * `POST /api/microsoft-teams/messages`
 *
 * The Bot Framework JWT authenticates the Connector, app, channel and service
 * URL. Teams routing context is then derived from the authenticated activity
 * and checked against configured installations and destinations. The Azure Bot
 * resource's messaging endpoint should point here; the
 * Teams app manifest does not carry a `botsEndpoint` property.
 *
 * Handles:
 *  - `invoke` (`adaptiveCard/action`) → capability-aware war-room ChatOps (Phase 4)
 *  - `conversationUpdate` → record/update MicrosoftTeamsInstallation when the bot is added to a team
 *  - `message` → @mentions and personal chats: help/status answered inline, the rest queued for Squire
 */

type TeamsActivity = {
  type?: string;
  id?: string;
  channelId?: string;
  serviceUrl?: string;
  from?: { id?: string; aadObjectId?: string; name?: string };
  recipient?: { id?: string };
  conversation?: { id?: string; name?: string; isGroup?: boolean; conversationType?: string };
  channelData?: {
    team?: { id?: string; name?: string; aadGroupId?: string };
    tenant?: { id?: string };
    channel?: { id?: string; name?: string };
  };
  membersAdded?: Array<{ id?: string }>;
  membersRemoved?: Array<{ id?: string }>;
  name?: string;
  value?: unknown;
  replyToId?: string;
  text?: string;
  entities?: Array<{ type?: string; mentioned?: { id?: string } } | null>;
};

function isTruthyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Health checklist "last inbound activity": at most one write per tenant every 5 minutes. */
async function touchTeamsInstallationActivity(tenantId: string): Promise<void> {
  const now = new Date();
  try {
    await prisma.microsoftTeamsInstallation.updateMany({
      where: {
        tenantId,
        enabled: true,
        OR: [
          { lastActivityAt: null },
          { lastActivityAt: { lt: new Date(now.getTime() - ACTIVITY_TOUCH_INTERVAL_MS) } },
        ],
      },
      data: { lastActivityAt: now },
    });
  } catch (error) {
    logger.debug('[MicrosoftTeams] lastActivityAt update skipped', {
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
  }
}

/**
 * A message addressed to the bot: an @mention in a channel or group chat, or any message in
 * a personal chat. help/status are answered here; everything else goes to Squire. Never throws
 * for a reply failure: Teams would redeliver and the user would see duplicates.
 */
async function handleTeamsBotMessage(activity: TeamsActivity, tenantId: string): Promise<void> {
  const [{ mentionsBot, enqueueTeamsSquireMention, findTeamsWarRoomIncident }, commands] =
    await Promise.all([
      import('@/lib/chatops/squire/teams'),
      import('@/lib/microsoft-teams/bot-commands'),
    ]);
  const conversation = commands.teamsConversationKind(activity.conversation);
  const botId = activity.recipient?.id?.trim();
  const addressed = conversation === 'personal' || mentionsBot(activity);
  if (!addressed || !botId) return;
  const { isSquireChatOpsEnabled, chatBaseUrl } = await import('@/lib/chatops/squire/switches');
  const squireEnabled = await isSquireChatOpsEnabled();
  const command = commands.parseTeamsBotCommand(activity.text);

  if (command.kind === 'squire' && squireEnabled) {
    // A personal chat is addressed to the bot by definition; Squire's queue expects a mention.
    const forSquire =
      conversation === 'personal' && !mentionsBot(activity)
        ? {
            ...activity,
            entities: [...(activity.entities ?? []), { type: 'mention', mentioned: { id: botId } }],
          }
        : activity;
    await enqueueTeamsSquireMention(forSquire, tenantId);
    return;
  }

  let card: Record<string, unknown>;
  if (command.kind === 'status') {
    const channelIds = [
      ...new Set(
        [
          activity.channelData?.channel?.id?.trim(),
          activity.conversation?.id?.split(';')[0]?.trim(),
        ].filter((value): value is string => Boolean(value))
      ),
    ];
    const incidentId =
      conversation === 'personal' ? null : await findTeamsWarRoomIncident(tenantId, channelIds);
    const incident = incidentId
      ? await prisma.incident.findUnique({
          where: { id: incidentId },
          select: {
            id: true,
            title: true,
            status: true,
            urgency: true,
            service: { select: { name: true } },
          },
        })
      : null;
    card = commands.buildTeamsStatusCard(
      incident ? { ...incident, serviceName: incident.service?.name ?? null } : null,
      chatBaseUrl()
    );
  } else {
    if (!squireEnabled && command.kind === 'squire') {
      logger.info('[MicrosoftTeams] Bot message not answered: Squire in chat is off', {
        conversation,
      });
    }
    card = commands.buildTeamsHelpCard({ squireEnabled, conversation });
  }

  const serviceUrl = activity.serviceUrl?.trim();
  const conversationId = activity.conversation?.id?.trim();
  const replyToId = activity.id?.trim();
  if (!serviceUrl || !conversationId || !replyToId) return;
  try {
    const { replyToMicrosoftTeamsActivity } = await import('@/lib/microsoft-teams/client');
    const result = await replyToMicrosoftTeamsActivity({
      tenantId,
      serviceUrl,
      conversationId,
      replyToId,
      card,
    });
    if (!result.success) {
      logger.warn('[MicrosoftTeams] Bot reply failed', {
        code: result.errorCode ?? null,
        status: result.statusCode ?? null,
      });
    }
  } catch (error) {
    logger.warn('[MicrosoftTeams] Bot reply failed', {
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    return NextResponse.json({ error: 'Teams activity payload is too large' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch (e) {
    return jsonError(new AppError({ code: 'INVALID_JSON', cause: e as Error }));
  }

  const activity = (body ?? {}) as TeamsActivity;
  const activityType = typeof activity.type === 'string' ? activity.type : '';
  const activityServiceUrl = typeof activity.serviceUrl === 'string' ? activity.serviceUrl : null;

  // Verify the request is genuinely from Bot Framework / Teams via JWT.
  // Pass Activity.serviceUrl for token claim binding (prevents token replay across serviceUrl boundaries).
  const verifiedIdentity = await assertMicrosoftTeamsActivityAuth(request, {
    expectedServiceUrl: activityServiceUrl,
    expectedChannelId: activity.channelId ?? null,
  });
  if (!verifiedIdentity) {
    // In production without a valid Bearer token, reject with 401.
    // In non-production, allow through only if test header is set (handled inside assertMicrosoftTeamsActivityAuth).
    // For any other request, treat as unauthenticated.
    const isTestBypass =
      process.env.NODE_ENV !== 'production' &&
      request.headers.get('x-opsknight-teams-test') === '1';
    if (!isTestBypass) {
      logger.warn('[MicrosoftTeams] Rejected unverified Teams activity', { activityType });
      return NextResponse.json({ error: 'Teams activity verification required' }, { status: 401 });
    }
  }

  // Connector JWT authentication above establishes that this activity is
  // genuine Teams traffic. The customer tenant is defined by Teams channelData,
  // then checked against OpsKnight configuration/installations/destinations.
  const bodyTenantId = activity.channelData?.tenant?.id?.trim() || '';

  try {
    if (activityType === 'invoke' && activity.name === 'adaptiveCard/action') {
      const tenantId = bodyTenantId;
      if (!tenantId)
        return NextResponse.json({ error: 'Teams tenant is required' }, { status: 403 });
      const configured = await getMicrosoftTeamsConfig();
      if (!configured)
        return NextResponse.json({ error: 'Microsoft Teams is not configured' }, { status: 403 });
      const allowlist = await enforceMicrosoftTeamsTenantAllowlist(tenantId, configured.config);
      if (!allowlist.allowed)
        return NextResponse.json(
          { error: allowlist.reason, code: allowlist.code },
          { status: 403 }
        );
      await touchTeamsInstallationActivity(tenantId);
      // Squire suggestion cards: confirmed inline through the sealed proposal executor.
      const { isTeamsSquireInvoke } = await import('@/lib/chatops/squire/render');
      if (isTeamsSquireInvoke(activity.value)) {
        const { handleTeamsSquireConfirm } = await import('@/lib/chatops/squire/teams');
        return NextResponse.json(
          await handleTeamsSquireConfirm({ activity, verifiedTenantId: tenantId }),
          { status: 200 }
        );
      }
      const { handleMicrosoftTeamsAdaptiveCardAction } =
        await import('@/lib/microsoft-teams/invoke');
      const response = await handleMicrosoftTeamsAdaptiveCardAction({
        activity,
        verifiedTenantId: tenantId,
      });
      return NextResponse.json(response, { status: 200 });
    }
    if (activityType === 'conversationUpdate') {
      const conversationType = activity.conversation?.conversationType;
      // Installs in a personal or group chat are not Team installations: never record them as
      // one (their conversation id would masquerade as a teamId). The bot just answers there.
      if (conversationType === 'personal' || conversationType === 'groupChat') {
        return jsonOk({ ok: true });
      }
      const tenantId = bodyTenantId;
      const teamId =
        activity.channelData?.team?.aadGroupId?.trim() ||
        activity.channelData?.team?.id?.trim() ||
        activity.conversation?.id?.trim();
      const channelId = activity.channelData?.channel?.id?.trim();
      const teamName =
        activity.channelData?.team?.name?.trim() || activity.conversation?.name?.trim() || null;

      if (isTruthyString(tenantId) && isTruthyString(teamId)) {
        // Phase 7/13: tenant allowlist — SINGLE must match configured tenant, MULTI allows any verified tid.
        // We do this *after* deriving tenantId so the test harness (__test__) still works.
        const isTestTenant =
          verifiedIdentity?.appId === '__test__' && process.env.NODE_ENV !== 'production';
        if (!isTestTenant) {
          const configForAllowlist = await getMicrosoftTeamsConfig();
          // Fail closed: SINGLE mode needs a configured tenant that matches (an empty
          // tenantId used to accept any tenant here); unconfigured means no installs.
          const singleTenantCheck = !configForAllowlist
            ? {
                allowed: false as const,
                reason: 'Microsoft Teams is not configured',
                code: 'NOT_CONFIGURED',
              }
            : configForAllowlist.config.tenantMode === 'SINGLE'
              ? await enforceMicrosoftTeamsTenantAllowlist(tenantId, configForAllowlist.config)
              : ({ allowed: true } as const);
          if (!singleTenantCheck.allowed) {
            const cfgTid = configForAllowlist?.config.tenantId?.trim() || '';
            logger.warn('[MicrosoftTeams] conversationUpdate rejected by tenant policy', {
              code: singleTenantCheck.code,
              tenantId: tenantId.slice(0, 8) + '…',
              cfgTid: cfgTid ? cfgTid.slice(0, 8) + '…' : '(empty)',
              teamId: teamId.slice(0, 12) + '…',
            });
            try {
              await emitAuditEvent({
                action: 'microsoftTeams.installation.tenant_mismatch',
                source: 'INTEGRATION',
                target: { type: 'SYSTEM_CONFIG', id: tenantId },
                actor: { type: 'SYSTEM' },
                metadata: {
                  provider: 'MICROSOFT_TEAMS',
                  connectorAppId: verifiedIdentity?.appId ?? null,
                  bodyTenantId,
                  tenantId,
                  teamId,
                  code: singleTenantCheck.code,
                  activityType: 'conversationUpdate',
                  activityId: activity.id ?? null,
                },
              });
            } catch {}
            return NextResponse.json(
              { error: singleTenantCheck.reason, code: singleTenantCheck.code },
              { status: 403 }
            );
          }
          // MULTI: any verified tenant is allowed — installation is the allowlist proof, so do not require pre-existing row.
        }

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
          const serviceUrl =
            typeof activity.serviceUrl === 'string'
              ? normalizeTrustedMicrosoftTeamsServiceUrl(activity.serviceUrl)
              : null;
          const conversationId =
            typeof activity.conversation?.id === 'string'
              ? activity.conversation.id.trim().slice(0, 512)
              : null;
          const botRecipientId = activity.recipient?.id?.trim().slice(0, 256) || null;
          await prismaAny.microsoftTeamsInstallation.upsert({
            where: { tenantId_teamId: { tenantId, teamId } },
            create: {
              tenantId,
              teamId,
              teamName,
              channelId: channelId || null,
              serviceUrl,
              conversationId,
              botRecipientId,
              enabled: true,
              lastActivityAt: new Date(),
            },
            update: {
              teamName: teamName ?? undefined,
              channelId: channelId || undefined,
              ...(serviceUrl ? { serviceUrl } : {}),
              ...(conversationId ? { conversationId } : {}),
              ...(botRecipientId ? { botRecipientId } : {}),
              enabled: true,
              lastActivityAt: new Date(),
            },
          } as unknown as never);
          logger.info('[MicrosoftTeams] Installation recorded', { tenantId, teamId });
          try {
            await emitAuditEvent({
              action: 'microsoftTeams.installation.upserted',
              source: 'INTEGRATION',
              target: { type: 'SYSTEM_CONFIG', id: `${tenantId}:${teamId}` },
              actor: { type: 'SYSTEM' },
              metadata: {
                provider: 'MICROSOFT_TEAMS',
                tenantId,
                teamId,
                teamName,
                channelId,
                activityId: activity.id ?? null,
                connectorAppId: verifiedIdentity?.appId ?? null,
              },
            });
          } catch {}
        } else if (botRemoved) {
          const revoked = await prisma.$transaction(async tx => {
            const destRows = await tx.microsoftTeamsDestination.findMany({
              where: { tenantId, teamId },
              select: { id: true },
            });
            await tx.microsoftTeamsInstallation.updateMany({
              where: { tenantId, teamId },
              data: { enabled: false },
            });
            await tx.microsoftTeamsDestination.updateMany({
              where: { tenantId, teamId },
              data: { enabled: false, interactiveEnabled: false },
            });
            const revoked = await revokeMicrosoftTeamsOperations(tx, {
              destinationIds: destRows.map(row => row.id),
              reason: 'Microsoft Teams app was removed from this Team',
            });
            await revokeMicrosoftTeamsWarRoomProvisioning(tx, {
              destinationIds: destRows.map(row => row.id),
              reason: 'Microsoft Teams app was removed from this Team',
            });
            return revoked;
          }, TEAMS_REVOCATION_TX_OPTIONS);
          logger.info('[MicrosoftTeams] Teams operations settled after bot removal', {
            tenantId,
            teamId,
            revokedCount: revoked.operationIds.length,
          });
          logger.info('[MicrosoftTeams] Installation revoked — destinations disabled', {
            tenantId,
            teamId,
          });
          try {
            await emitAuditEvent({
              action: 'microsoftTeams.installation.revoked',
              source: 'INTEGRATION',
              target: { type: 'SYSTEM_CONFIG', id: `${tenantId}:${teamId}` },
              actor: { type: 'SYSTEM' },
              metadata: {
                provider: 'MICROSOFT_TEAMS',
                tenantId,
                teamId,
                channelId,
                activityId: activity.id ?? null,
                connectorAppId: verifiedIdentity?.appId ?? null,
              },
            });
          } catch {}
        }
      }
      return jsonOk({ ok: true });
    }

    if (activityType === 'message') {
      // Channels deliver only @mentions (or every message with RSC); personal and group chats
      // arrive once the 1.4.0 package is installed. The tenant must pass the same allowlist as
      // card actions; anything else, including unknown conversation types, stays a quiet no-op.
      const tenantId = bodyTenantId;
      const configured = tenantId ? await getMicrosoftTeamsConfig() : null;
      if (
        !configured ||
        !(await enforceMicrosoftTeamsTenantAllowlist(tenantId, configured.config)).allowed
      ) {
        return jsonOk({ ok: true });
      }
      await touchTeamsInstallationActivity(tenantId);
      await handleTeamsBotMessage(activity, tenantId);
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
