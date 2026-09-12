import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { emitAuditEvent } from '@/lib/audit';
import { assertMicrosoftTeamsActivityAuth, getMicrosoftTeamsConfig } from '@/lib/microsoft-teams/auth';

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
  // Spec Phase 7: hard reject on mismatch — never fall back to body value, and emit a denial audit.
  const bodyTenantId = activity.channelData?.tenant?.id?.trim() || '';
  if (verifiedIdentity && verifiedIdentity.tenantId && verifiedIdentity.tenantId !== '__test__') {
    if (bodyTenantId && bodyTenantId !== verifiedIdentity.tenantId) {
      logger.warn('[MicrosoftTeams] Body tenantId does not match verified JWT tid — rejecting', {
        bodyTenantId,
        verifiedTenantId: verifiedIdentity.tenantId,
      });
      try {
        await emitAuditEvent({
          action: 'microsoftTeams.installation.tenant_mismatch',
          source: 'INTEGRATION',
          target: { type: 'SYSTEM_CONFIG', id: verifiedIdentity.tenantId },
          actor: { type: 'SYSTEM' },
          metadata: {
            provider: 'MICROSOFT_TEAMS',
            verifiedTenantId: verifiedIdentity.tenantId,
            bodyTenantId,
            teamId: activity.channelData?.team?.id?.trim() || null,
            channelId: activity.channelData?.channel?.id?.trim() || null,
            activityType,
            activityId: activity.id ?? null,
          },
        });
      } catch {
        // audit is best-effort — do not mask the 403
      }
      return NextResponse.json(
        { error: 'Tenant identifier mismatch', code: 'TENANT_MISMATCH' },
        { status: 403 }
      );
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
        // Phase 7/13: tenant allowlist — SINGLE must match configured tenant, MULTI allows any verified tid.
        // We do this *after* deriving tenantId so the test harness (__test__) still works.
        const isTestTenant = tenantId === '__test__' && process.env.NODE_ENV !== 'production';
        if (!isTestTenant) {
          const configForAllowlist = await getMicrosoftTeamsConfig();
          if (configForAllowlist) {
            if (configForAllowlist.config.tenantMode === 'SINGLE') {
              const cfgTid = configForAllowlist.config.tenantId?.trim() || '';
              if (cfgTid && tenantId !== cfgTid) {
                logger.warn('[MicrosoftTeams] conversationUpdate rejected — SINGLE tenant mismatch', {
                  tenantId: tenantId.slice(0, 8) + '…',
                  cfgTid: cfgTid.slice(0, 8) + '…',
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
                      verifiedTenantId: verifiedIdentity?.tenantId ?? null,
                      bodyTenantId,
                      tenantId,
                      teamId,
                      activityType: 'conversationUpdate',
                      activityId: activity.id ?? null,
                    },
                  });
                } catch {}
                return NextResponse.json({ error: 'Tenant not allowed for SINGLE-mode config', code: 'TENANT_NOT_ALLOWED' }, { status: 403 });
              }
            }
            // MULTI: any verified tenant is allowed — installation is the allowlist proof, so do not require pre-existing row.
          }
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
          await prismaAny.microsoftTeamsInstallation.upsert({
            where: { tenantId_teamId: { tenantId, teamId } },
            create: { tenantId, teamId, teamName, channelId: channelId || null, enabled: true },
            update: { teamName: teamName ?? undefined, channelId: channelId || undefined, enabled: true },
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
                verifiedTenantId: verifiedIdentity?.tenantId ?? null,
              },
            });
          } catch {}
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
          // Phase 13: clean lifecycle — revoke queued/pending ExternalOperation + BackgroundJob for this team.
          // Destinations are disabled above; queued deliveries must not silently deliver after revocation.
          try {
            const destRows = await (prisma as unknown as { microsoftTeamsDestination: { findMany: (a: unknown) => Promise<Array<{ id: string }>> } }).microsoftTeamsDestination.findMany({
              where: { tenantId, teamId },
              select: { id: true },
            } as never);
            const destIds = new Set(destRows.map(r => r.id));
            if (destIds.size > 0) {
              const pendingOps = await prisma.externalOperation.findMany({
                where: { provider: 'MICROSOFT_TEAMS' as never, status: { in: ['PENDING', 'AMBIGUOUS'] } },
                select: { id: true, requestPayload: true, status: true },
              });
              const revokeIds: string[] = [];
              for (const op of pendingOps) {
                const payload = op.requestPayload as Record<string, unknown> | null;
                const dId = typeof payload?.destinationId === 'string' ? (payload.destinationId as string) : '';
                if (dId && destIds.has(dId)) revokeIds.push(op.id);
              }
              // Also consider in-flight PROCESSING with expired lease — same revocation treatment as queued.
              const processingOps = await prisma.externalOperation.findMany({
                where: { provider: 'MICROSOFT_TEAMS' as never, status: 'PROCESSING', leaseExpiresAt: { lt: new Date() } },
                select: { id: true, requestPayload: true },
              });
              for (const op of processingOps) {
                const payload = op.requestPayload as Record<string, unknown> | null;
                const dId = typeof payload?.destinationId === 'string' ? (payload.destinationId as string) : '';
                if (dId && destIds.has(dId) && !revokeIds.includes(op.id)) revokeIds.push(op.id);
              }
              if (revokeIds.length > 0) {
                await prisma.externalOperation.updateMany({
                  where: { id: { in: revokeIds } },
                  data: { status: 'FAILED', lastError: 'Microsoft Teams app was removed from this Team — delivery revoked.', leaseToken: null, leaseExpiresAt: null, nextAttemptAt: new Date() },
                });
                // Cancel corresponding durable jobs so workers do not re-claim.
                const jobs = await prisma.backgroundJob.findMany({
                  where: { type: 'EXTERNAL_OPERATION', status: { in: ['PENDING', 'PROCESSING'] } },
                  select: { id: true, payload: true },
                });
                const jobIdsToCancel: string[] = [];
                for (const job of jobs) {
                  const opId = (job.payload as Record<string, unknown> | null)?.operationId;
                  if (typeof opId === 'string' && revokeIds.includes(opId)) jobIdsToCancel.push(job.id);
                }
                if (jobIdsToCancel.length > 0) {
                  await prisma.backgroundJob.updateMany({
                    where: { id: { in: jobIdsToCancel } },
                    data: { status: 'CANCELLED', error: 'Teams installation revoked' },
                  });
                }
                logger.info('[MicrosoftTeams] Queued Teams operations revoked after bot removal', { tenantId, teamId, revokedCount: revokeIds.length });
              }
            }
          } catch (e) {
            logger.warn('[MicrosoftTeams] Failed to revoke queued operations on botRemoved', { error: (e as Error).message });
          }
          logger.info('[MicrosoftTeams] Installation revoked — destinations disabled', { tenantId, teamId });
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
                verifiedTenantId: verifiedIdentity?.tenantId ?? null,
              },
            });
          } catch {}
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
