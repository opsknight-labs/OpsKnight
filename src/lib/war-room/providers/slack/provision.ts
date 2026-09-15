import 'server-only';

import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { getSlackBotToken } from '@/lib/slack';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { adoptWarRoomChannel, claimWarRoomProvisioning } from '../../repository';
import { evaluateWarRoomPolicy } from '../../policy';
import { projectSlackWarRoomToLegacyIncident } from '../../slack-compatibility';
import { WarRoomRetryableError } from '../../errors';
import { findExistingSlackChannel, findSlackChannelByMarker, slackApiCall, slackWarRoomMarker } from './client';
import { generateBridgeUrl } from '../../bridge';

const AMBIGUOUS_RECONCILIATION_WINDOW_MS = 15 * 60_000;

type RequestResult =
  | { accepted: true; warRoomId: string; state: string }
  | { accepted: false; code: string };

function slugify(name: string, maxLen = 40): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

function slackChannelName(config: { channelPrefix?: string | null }, serviceName: string, incidentId: string): string {
  const serviceSlug = slugify(serviceName);
  const idSuffix = incidentId.slice(-6);
  const safePrefix =
    (config.channelPrefix || 'incident')
      .toLowerCase()
      .replace(/^#+/, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/[-_]{2,}/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '') || 'incident';
  return `${safePrefix}-${idSuffix}-${serviceSlug}`.slice(0, 80);
}

function classifySlackCreateResult(result: { ok: boolean; error?: string; httpStatus?: number; transportFailure?: boolean; sideEffectAmbiguous?: boolean }): 'SUCCESS' | 'AMBIGUOUS' | 'RETRYABLE_NOT_AMBIGUOUS' | 'TERMINAL' | 'NAME_TAKEN' {
  if (result.ok) return 'SUCCESS';
  if (result.error === 'name_taken') return 'NAME_TAKEN';
  // Structured transport ambiguity wins over string parsing — this is the fix for
  // the "500 → 'Internal Server Error' parsed as terminal" bug on non-idempotent POSTs.
  if (result.sideEffectAmbiguous) return 'AMBIGUOUS';
  // 429 / 5xx already surfaced as sideEffectAmbiguous above; keep retryable classification
  // for non-ambiguous transport retries only (read-path rate-limits, etc.).
  if (result.transportFailure) return 'AMBIGUOUS';
  const lower = (result.error ?? '').toLowerCase();
  if (
    lower.includes('rate_limited') ||
    lower.includes('ratelimited') ||
    lower.includes('timeout') ||
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  )
    return 'AMBIGUOUS';
  return 'TERMINAL';
}

async function markFailed(id: string, provisioningToken: string, code: string, message: string): Promise<void> {
  await prisma.incidentWarRoom.updateMany({
    where: { id, provisioningToken, state: { in: ['PROVISIONING', 'AMBIGUOUS'] } },
    data: {
      state: 'FAILED',
      lastErrorCode: code,
      lastError: message.slice(0, 1000),
      provisioningToken: null,
    },
  });
  await projectSlackWarRoomToLegacyIncident(id).catch(() => {});
}

async function ensureTerminalCloseHandoff(warRoomId: string, incidentId: string): Promise<void> {
  const { ensureTerminalCloseJobsAfterClosingAdoption } = await import('../../engine');
  const { closeWarRoomNeutral } = await import('../../engine');
  let ensured = false;
  let ensureError: unknown = null;
  try {
    await ensureTerminalCloseJobsAfterClosingAdoption(warRoomId, incidentId);
    ensured = true;
  } catch (e) {
    ensureError = e;
  }
  const existing = await prisma.backgroundJob.findFirst({
    where: { type: 'WAR_ROOM_CLOSE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: warRoomId } },
    select: { id: true },
  });
  if (existing) return;
  // No durable close owner — surface the original persistence failure so the
  // WAR_ROOM_PROVISION job retries instead of completing and stranding CLOSING.
  if (!ensured && ensureError) throw ensureError;
  // Fallback repair path: idempotent neutral close (also durable, may throw).
  await closeWarRoomNeutral({ incidentId, warRoomId });
  const afterRepair = await prisma.backgroundJob.findFirst({
    where: { type: 'WAR_ROOM_CLOSE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: warRoomId } },
    select: { id: true },
  });
  if (!afterRepair) {
    // P2002 duplicate race: another worker already inserted. Retries are
    // exactly what we want — treat as success.
    throw new WarRoomRetryableError('Terminal close ownership not yet durable; retrying.', 2000, true);
  }
}

/** Durable request boundary. No Slack I/O occurs here. */
export async function requestSlackWarRoom(
  incidentId: string,
  intent: { manual: boolean; allowNewGeneration: boolean }
): Promise<RequestResult> {
  let claimedResult: { claimed: boolean; warRoom: { id: string; state: string; provisioningToken: string | null } } | null = null;

  const result = await runSerializableTransaction(async tx => {
    const incident = await tx.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: {
          include: { slackIntegration: { select: { workspaceId: true } } },
        },
      },
    });
    if (!incident) return { accepted: false as const, code: 'INCIDENT_NOT_FOUND' };
    if (!['OPEN', 'ACKNOWLEDGED'].includes(incident.status))
      return { accepted: false as const, code: 'INCIDENT_NOT_ACTIVE' };

    const [config, globalIntegration] = await Promise.all([
      tx.chatOpsConfig.findUnique({ where: { id: 'default' } }),
      tx.slackIntegration.findFirst({
        where: { enabled: true, services: { none: {} } },
        select: { workspaceId: true },
      }),
    ]);

    const slackWorkspaceId =
      incident.service.slackIntegration?.workspaceId || globalIntegration?.workspaceId || null;

    const destination = slackWorkspaceId
      ? {
          enabled: true,
          warRoomEnabled: true,
          autoCreate: incident.service.autoCreateWarRoom,
          membershipType: 'STANDARD' as const,
        }
      : null;

    // Fetch incident visibility for policy
    const policyIncident = await tx.incident.findUnique({
      where: { id: incidentId },
      select: { urgency: true, priority: true, visibility: true },
    });
    const decision = evaluateWarRoomPolicy({
      incident: {
        urgency: policyIncident?.urgency ?? incident.urgency,
        priority: policyIncident?.priority ?? incident.priority,
        visibility: policyIncident?.visibility ?? 'PUBLIC',
      },
      service: { autoCreate: incident.service.autoCreateWarRoom },
      destination,
      config: {
        enabled: Boolean(config?.enabled),
        warRoomsEnabled: true,
        autoCreateOnUrgency: config?.autoCreateOnUrgency ?? [],
        autoCreateOnPriority: config?.autoCreateOnPriority ?? [],
        defaultMembershipType: 'STANDARD',
      },
      manual: intent.manual,
    });

    // Slack adapter declares privateRooms:false; a PRIVATE war room must fail closed
    // rather than silently creating a STANDARD channel and leaking visibility.
    if (decision.allowed && decision.membershipType === 'PRIVATE') {
      return { accepted: false as const, code: 'PRIVATE_DOWNGRADE_DENIED' };
    }

    if (!decision.allowed || !slackWorkspaceId || !destination)
      return {
        accepted: false as const,
        code: decision.allowed ? 'DESTINATION_UNAVAILABLE' : decision.code,
      };

    const claimed = await claimWarRoomProvisioning(tx, {
      incidentId,
      provider: 'SLACK',
      reopen: intent.allowNewGeneration,
    });

    claimedResult = claimed as unknown as typeof claimedResult;

    if (claimed.claimed) {
      await tx.incidentWarRoom.updateMany({
        where: { id: claimed.warRoom.id, provisioningToken: claimed.warRoom.provisioningToken!, state: 'PROVISIONING' },
        data: {
          providerTenantId: slackWorkspaceId,
          membershipType: decision.membershipType,
        },
      });
      await tx.backgroundJob.create({
        data: {
          type: 'WAR_ROOM_PROVISION',
          status: 'PENDING',
          scheduledAt: new Date(),
          maxAttempts: 6,
          payload: {
            warRoomId: claimed.warRoom.id,
            provisioningToken: claimed.warRoom.provisioningToken,
          },
        },
      });
    }

    return {
      accepted: true as const,
      warRoomId: claimed.warRoom.id,
      state: claimed.warRoom.state,
    };
  });

  if (result.accepted && claimedResult && (claimedResult as { claimed: boolean }).claimed) {
    await projectSlackWarRoomToLegacyIncident(result.warRoomId).catch(() => {});
  } else if (result.accepted && claimedResult) {
    // Even when not claimed (already provisioning), ensure legacy is fresh
    await projectSlackWarRoomToLegacyIncident(result.warRoomId).catch(() => {});
  }

  return result;
}

async function findExistingChannel(botToken: string, channelName: string): Promise<{ id: string; name: string } | null> {
  return findExistingSlackChannel(botToken, channelName);
}

function deterministicCollisionSuffix(provisioningToken: string, generation: number): string {
  // Deterministic per-generation suffix so a lost-response retry reuses the same alternate name
  // instead of creating an orphaned duplicate channel. 4 chars from token hash + generation.
  const h = provisioningToken.replace(/-/g, '').slice(-4);
  return `${h}${String(generation % 10)}`.slice(0, 4).padStart(4, '0');
}

/** Worker entry point. Every retry reconciles this same generation before POST. */
export async function provisionSlackWarRoom(
  warRoomId: string,
  expectedProvisioningToken: string,
  opts?: { reconciliationOnly?: boolean }
): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: {
      incident: {
        include: {
          service: {
            select: {
              id: true,
              name: true,
              warRoomVideoBridge: true,
              warRoomCustomBridgeUrl: true,
              slackIntegration: { select: { workspaceId: true } },
            },
          },
          assignee: { select: { id: true, name: true } },
        },
      },
    },
  });

  const reconciliationOnly = opts?.reconciliationOnly === true;

  if (
    !room ||
    room.provisioningToken !== expectedProvisioningToken ||
    room.provider !== 'SLACK' ||
    !room.provisioningToken
  )
    return;

  if (reconciliationOnly) {
    if (!['AMBIGUOUS', 'CLOSING'].includes(room.state)) return;
  } else {
    if (!['PROVISIONING', 'AMBIGUOUS'].includes(room.state)) return;
  }

  // Slack declares privateRooms:false — never provision a PRIVATE room even if racing overrides fill it.
  if (!reconciliationOnly && room.membershipType === 'PRIVATE') {
    await markFailed(room.id, expectedProvisioningToken, 'PRIVATE_WAR_ROOM_UNSUPPORTED', 'Slack war rooms do not support private rooms.');
    return;
  }

  const incident = room.incident;
  // Authority check before any Slack I/O — skipped for reconciliationOnly
  // (CLOSING reconciliation must run even when incident is RESOLVED).
  if (!reconciliationOnly) {
    const currentIncident = await prisma.incident.findUnique({
      where: { id: incident.id },
      select: { status: true, title: true, urgency: true },
    });
    if (!currentIncident || !['OPEN', 'ACKNOWLEDGED'].includes(currentIncident.status)) {
      if (room.state === 'AMBIGUOUS') return;
      await markFailed(room.id, expectedProvisioningToken, 'INCIDENT_NOT_ACTIVE', 'Incident is no longer active.');
      return;
    }
  }

  const config = await prisma.chatOpsConfig.findUnique({ where: { id: 'default' } });
  const isClosingReconciliation = reconciliationOnly && room.state === 'CLOSING' && room.createAttemptedAt != null;
  const closingReconciliationDeadline = isClosingReconciliation ? room.createAttemptedAt!.getTime() + AMBIGUOUS_RECONCILIATION_WINDOW_MS : 0;
  const closingReconciliationExpired = isClosingReconciliation && Date.now() >= closingReconciliationDeadline;
  if (!config?.enabled) {
    if (isClosingReconciliation) {
      if (closingReconciliationExpired) {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
          data: {
            health: 'DEGRADED',
            lastErrorCode: 'RECONCILIATION_EXPIRED_CHATOPS_DISABLED',
            lastError: 'ChatOps disabled beyond reconciliation window; closing locally as DEGRADED with unverified external outcome. Provider drift will be reconciled asynchronously.',
            provisioningToken: null,
          },
        });
        const fresh = await prisma.incidentWarRoom.findUnique({ where: { id: room.id }, select: { incidentId: true } });
        if (fresh) await ensureTerminalCloseHandoff(room.id, fresh.incidentId);
        return;
      }
      // Cleanup is lifecycle recovery, not feature provisioning — do not fail
      // to FAILED when ChatOps was disabled after the attempt. Keep CLOSING
      // and retry boundedly so the external identity is still reconciled.
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
        data: {
          health: 'DEGRADED',
          lastErrorCode: 'CHATOPS_DISABLED_DURING_CLOSE_RECONCILIATION',
          lastError: 'ChatOps is disabled but CLOSING reconciliation keeps retrying until marker resolved.',
        },
      });
      throw new WarRoomRetryableError('ChatOps disabled during CLOSING reconciliation; retrying.', 30_000, true);
    }
    await markFailed(room.id, expectedProvisioningToken, 'CHATOPS_DISABLED', 'ChatOps is not enabled');
    return;
  }

  const botToken = await getSlackBotToken(incident.serviceId);
  if (!botToken) {
    if (isClosingReconciliation) {
      if (closingReconciliationExpired) {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
          data: {
            health: 'DEGRADED',
            lastErrorCode: 'RECONCILIATION_EXPIRED_SLACK_BOT_TOKEN_MISSING',
            lastError: 'No Slack bot token beyond reconciliation window; closing locally as DEGRADED with unverified external outcome.',
            provisioningToken: null,
          },
        });
        const fresh = await prisma.incidentWarRoom.findUnique({ where: { id: room.id }, select: { incidentId: true } });
        if (fresh) await ensureTerminalCloseHandoff(room.id, fresh.incidentId);
        return;
      }
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
        data: {
          health: 'DEGRADED',
          lastErrorCode: 'SLACK_BOT_TOKEN_MISSING_DURING_CLOSE',
          lastError: 'No Slack bot token during CLOSING reconciliation; keeping CLOSING for retry.',
        },
      });
      throw new WarRoomRetryableError('No Slack bot token during CLOSING reconciliation; retrying.', 30_000, true);
    }
    await markFailed(room.id, expectedProvisioningToken, 'SLACK_BOT_TOKEN_MISSING', 'No Slack bot token configured');
    return;
  }

  const slackWorkspaceId =
    incident.service.slackIntegration?.workspaceId ||
    (
      await prisma.slackIntegration.findFirst({
        where: { enabled: true, services: { none: {} } },
        select: { workspaceId: true },
      })
    )?.workspaceId ||
    room.providerTenantId;

  if (!slackWorkspaceId) {
    if (isClosingReconciliation) {
      if (closingReconciliationExpired) {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
          data: {
            health: 'DEGRADED',
            lastErrorCode: 'RECONCILIATION_EXPIRED_SLACK_WORKSPACE_MISSING',
            lastError: 'No Slack workspace beyond reconciliation window; closing locally as DEGRADED with unverified external outcome.',
            provisioningToken: null,
          },
        });
        const fresh = await prisma.incidentWarRoom.findUnique({ where: { id: room.id }, select: { incidentId: true } });
        if (fresh) await ensureTerminalCloseHandoff(room.id, fresh.incidentId);
        return;
      }
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
        data: {
          health: 'DEGRADED',
          lastErrorCode: 'SLACK_WORKSPACE_MISSING_DURING_CLOSE',
          lastError: 'No Slack workspace during CLOSING reconciliation; keeping CLOSING for retry.',
        },
      });
      throw new WarRoomRetryableError('No Slack workspace during CLOSING reconciliation; retrying.', 30_000, true);
    }
    await markFailed(room.id, expectedProvisioningToken, 'SLACK_WORKSPACE_MISSING', 'No Slack workspace installation configured');
    return;
  }

  const channelName = slackChannelName(config, incident.service.name, incident.id);
  const marker = slackWarRoomMarker(incident.id, room.generation);

  // 1) Reconcile BEFORE any POST:
  //    - marker match  → safe to adopt (ownership proof)
  //    - plannedExternalName match → safe (unique durable identity for this generation)
  //    - generic base-name match WITHOUT marker/planned identity → NEVER adopt — it is a collision
  // Marker scan is expensive (list + info per channel); skip it on fresh
  // provision where no create has been attempted yet.
  try {
    const needsMarkerScan = Boolean(room.createAttemptedAt) || room.state === 'AMBIGUOUS';
    let markerMatch: { id: string; name: string } | null = null;
    if (needsMarkerScan) {
      try {
        markerMatch = await findSlackChannelByMarker(botToken, marker);
      } catch {}
      if (markerMatch) {
        const warRoomUrl = generateBridgeUrl(
          incident.id,
          incident.service.warRoomVideoBridge || config.defaultVideoBridge,
          incident.service.warRoomCustomBridgeUrl || config.customBridgeUrlTemplate
        );
        const adoption = await runSerializableTransaction(tx =>
          adoptWarRoomChannel(tx, {
            warRoomId: room.id,
            provisioningToken: expectedProvisioningToken,
            providerTenantId: slackWorkspaceId,
            channelId: markerMatch!.id,
            channelName: markerMatch!.name,
            channelUrl: warRoomUrl,
          })
        );
        if (adoption === 'READY') {
          await projectSlackWarRoomToLegacyIncident(room.id).catch(() => {});
          const { projectIncidentWarRoomParticipants } = await import('../../participant-desired-state');
          const { scheduleJob } = await import('@/lib/jobs/queue');
          const { requestSlackWarRoomProjection } = await import('./projection');
          await projectIncidentWarRoomParticipants(room.id);
          await scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId: room.id }, 5);
          await requestSlackWarRoomProjection(room.id).catch(err =>
            logger.warn('[ChatOps] Failed to queue Slack projection after reconciliation', { error: err })
          );
          await prisma.incidentEvent.create({
            data: { incidentId: incident.id, message: `War-room channel #${markerMatch!.name} reconciled` },
          }).catch(() => {});
        } else if (adoption === 'CLOSING') {
          await projectSlackWarRoomToLegacyIncident(room.id).catch(() => {});
          const fresh = await prisma.incidentWarRoom.findUnique({ where: { id: room.id }, select: { incidentId: true } });
          if (fresh) {
            await ensureTerminalCloseHandoff(room.id, fresh.incidentId);
          }
        } else if (adoption === 'FENCED') {
          return;
        } else if (adoption === 'CLOSED') {
          await slackApiCall('conversations.archive', botToken, { channel: markerMatch!.id }).catch(() => {});
          await projectSlackWarRoomToLegacyIncident(room.id).catch(() => {});
        }
        return;
      }
    }
    // Check plannedExternalName (unique per-generation) — safe to adopt.
    if ((room as unknown as { plannedExternalName?: string | null }).plannedExternalName) {
      const planned = (room as unknown as { plannedExternalName: string | null }).plannedExternalName!;
      const plannedMatch = await findExistingChannel(botToken, planned);
      if (plannedMatch) {
        const warRoomUrl = generateBridgeUrl(
          incident.id,
          incident.service.warRoomVideoBridge || config.defaultVideoBridge,
          incident.service.warRoomCustomBridgeUrl || config.customBridgeUrlTemplate
        );
        const adoption = await runSerializableTransaction(tx =>
          adoptWarRoomChannel(tx, {
            warRoomId: room.id,
            provisioningToken: expectedProvisioningToken,
            providerTenantId: slackWorkspaceId,
            channelId: plannedMatch.id,
            channelName: plannedMatch.name,
            channelUrl: warRoomUrl,
          })
        );
        if (adoption === 'READY') {
          await projectSlackWarRoomToLegacyIncident(room.id).catch(() => {});
          const { projectIncidentWarRoomParticipants } = await import('../../participant-desired-state');
          const { scheduleJob } = await import('@/lib/jobs/queue');
          const { requestSlackWarRoomProjection } = await import('./projection');
          await projectIncidentWarRoomParticipants(room.id);
          await scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId: room.id }, 5);
          await requestSlackWarRoomProjection(room.id).catch(() => {});
        } else if (adoption === 'CLOSING') {
          await projectSlackWarRoomToLegacyIncident(room.id).catch(() => {});
          const fresh = await prisma.incidentWarRoom.findUnique({ where: { id: room.id }, select: { incidentId: true } });
          if (fresh) {
            await ensureTerminalCloseHandoff(room.id, fresh.incidentId);
          }
        }
        return;
      }
    }
    // Generic base-name match without ownership proof → collision. NEVER adopt;
    // fall through to the planned-name creation path / AMBIGUOUS gate.
  } catch (error) {
    if (error instanceof WarRoomRetryableError) throw error;
  }

  // reconciliationOnly: marker-only, never POST — must run for CLOSING as well as AMBIGUOUS
  if (reconciliationOnly) {
    // Marker/planned adoption already returned if found above. Here we are not-found.
    if (room.state === 'CLOSING' && room.createAttemptedAt) {
      const deadline = room.createAttemptedAt.getTime() + AMBIGUOUS_RECONCILIATION_WINDOW_MS;
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        throw new WarRoomRetryableError('Reconciling CLOSING Slack channel-create by marker/planned name.', Math.min(60_000, remaining), true);
      }
      // Window exhausted — channel definitively absent. Clear fencing token so
      // finalizeWarRoomCloseNeutral can proceed to ARCHIVED/CLOSED (NOT_FOUND is idempotent).
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'CLOSING' },
        data: {
          lastErrorCode: 'CREATE_RECONCILIATION_EXHAUSTED',
          lastError: 'No Slack channel was found by marker/planned name during reconciliation window; closing without external channel.',
          provisioningToken: null,
        },
      });
      const freshClose = await prisma.incidentWarRoom.findUnique({ where: { id: room.id }, select: { incidentId: true } });
      if (freshClose) {
        // Do not swallow durability failures — the reconciliation job must only
        // complete when terminal ownership is durable, otherwise it must retry.
        await ensureTerminalCloseHandoff(room.id, freshClose.incidentId);
      }
    }
    return;
  }

  // 2) Ambiguous gate: if we already attempted create, never blind POST again — reconcile only.
  // Reconciliation now looks for (marker OR plannedExternalName) — never generic name.
  if (room.createAttemptedAt) {
    const deadline = room.createAttemptedAt.getTime() + AMBIGUOUS_RECONCILIATION_WINDOW_MS;
    const remaining = deadline - Date.now();
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, provisioningToken: expectedProvisioningToken, state: { in: ['PROVISIONING', 'AMBIGUOUS'] } },
      data: {
        state: 'AMBIGUOUS',
        lastErrorCode: remaining > 0 ? 'CREATE_OUTCOME_RECONCILING' : 'CREATE_OUTCOME_UNRESOLVED',
        lastError:
          remaining > 0
            ? 'A prior Slack channel-create may have succeeded; reconciling by marker/planned name.'
            : 'Slack channel-create outcome remains unresolved after reconciliation window; operator reconciliation required.',
      },
    });
    if (remaining > 0) {
      // Reconcile by marker and planned name (not generic name) before re-queuing.
      try {
        const m = await findSlackChannelByMarker(botToken, marker);
        if (m) throw new WarRoomRetryableError('Found marker channel during AMBIGUOUS reconcile.', 1_000, true);
      } catch (e) {
        if (e instanceof WarRoomRetryableError) throw e;
      }
      const planned = (room as unknown as { plannedExternalName?: string | null }).plannedExternalName ?? null;
      if (planned) {
        try {
          const pm = await findExistingChannel(botToken, planned);
          if (pm) throw new WarRoomRetryableError('Found planned channel during AMBIGUOUS reconcile.', 1_000, true);
        } catch (e) {
          if (e instanceof WarRoomRetryableError) throw e;
        }
      }
      throw new WarRoomRetryableError('Reconciling ambiguous Slack channel-create by marker/planned name.', Math.min(60_000, remaining), true);
    }
    if (remaining <= 0) {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'AMBIGUOUS', createAttemptedAt: { not: null } },
        data: { state: 'FAILED', provisioningToken: null, lastErrorCode: 'CREATE_RECONCILIATION_EXHAUSTED', lastError: 'No Slack channel was found by marker/planned name during reconciliation window.' },
      });
      await projectSlackWarRoomToLegacyIncident(room.id).catch(() => {});
      // If close was requested while AMBIGUOUS, continue neutral close from now-Failed.
      const postFail = await prisma.incidentWarRoom.findUnique({
        where: { id: room.id },
        select: { closeRequestedAt: true },
      });
      if ((postFail as { closeRequestedAt?: Date | null } | null)?.closeRequestedAt != null) {
        const { closeWarRoomNeutral } = await import('../../engine');
        await closeWarRoomNeutral({ incidentId: incident.id, warRoomId: room.id }).catch(() => {});
      }
    }
    return;
  }

  // 3) Persist plannedExternalName durably BEFORE any conversations.create.
  // This is the durable alternate identity per generation. Slack cannot store the
  // marker atomically with create, so we use this unique name as the reconciliation anchor.
  const currentPlanned = (room as unknown as { plannedExternalName?: string | null }).plannedExternalName ?? null;
  if (!currentPlanned) {
    // First attempt for this generation: suffix comes from provisioningToken hash so it is
    // unique per generation/incident and stable across retries. Stored before POST.
    const suffix = deterministicCollisionSuffix(expectedProvisioningToken, room.generation);
    const plannedName = `${channelName.slice(0, 74)}-${suffix}`;
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, provisioningToken: expectedProvisioningToken },
      data: { plannedExternalName: plannedName } as unknown as Record<string, unknown>,
    });
    // Reload room so later steps read the updated plannedExternalName
    (room as unknown as { plannedExternalName?: string | null }).plannedExternalName = plannedName;
  }

  // Fresh authority check right before POST
  const freshRoom = await prisma.incidentWarRoom.findUnique({
    where: { id: room.id },
    select: { provisioningToken: true, state: true },
  });
  if (!freshRoom || freshRoom.provisioningToken !== expectedProvisioningToken || !['PROVISIONING', 'AMBIGUOUS'].includes(freshRoom.state)) return;

  // Mark attempt durably before POST
  const operationId = expectedProvisioningToken;
  const renewed = await prisma.incidentWarRoom.updateMany({
    where: { id: room.id, provisioningToken: expectedProvisioningToken, state: { in: ['PROVISIONING', 'AMBIGUOUS'] } },
    data: { provisioningStartedAt: new Date(), createAttemptedAt: new Date(), createOperationId: operationId },
  });
  if (renewed.count !== 1) return;

  // First create for this generation uses the durable plannedExternalName, not the
  // generic base. The base is a collision-prone hint; posting it would orphan the
  // channel when a lost-response retry adopts the suffixed identity instead.
  const plannedForCreate = (room as unknown as { plannedExternalName?: string | null }).plannedExternalName!;
  const effectiveChannelName = plannedForCreate;
  const createResult = await slackApiCall('conversations.create', botToken, {
    name: effectiveChannelName,
    is_private: false,
  });

  if (!createResult.ok) {
    const cls = classifySlackCreateResult(createResult);
    if (cls === 'AMBIGUOUS') {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken },
        data: { state: 'AMBIGUOUS', lastErrorCode: 'SLACK_CREATE_AMBIGUOUS', lastError: createResult.error ?? `Slack create ambiguous (HTTP ${createResult.httpStatus ?? '?'})` },
      });
      throw new WarRoomRetryableError(createResult.error ?? 'Slack create ambiguous', undefined, true);
    }

    // For any non-name_taken terminal failure, adopt ONLY if we find the persisted
    // plannedExternalName (not the generic base name) — name-only adoption is forbidden.
    if (cls !== 'NAME_TAKEN') {
      // No planned-name adoption attempted here for non-name_taken errors; fail through to terminal.
    }

    if (cls === 'NAME_TAKEN') {
      // Planned name collision — unique per-generation name is taken.
      // First try to adopt the existing channel with that exact name
      // (lost-response retry where channel was created but response lost).
      const altExisting = await findExistingChannel(botToken, effectiveChannelName).catch(() => null);
      if (altExisting) {
        const warRoomUrl = generateBridgeUrl(
          incident.id,
          incident.service.warRoomVideoBridge || config.defaultVideoBridge,
          incident.service.warRoomCustomBridgeUrl || config.customBridgeUrlTemplate
        );
        const adoption = await runSerializableTransaction(tx =>
          adoptWarRoomChannel(tx, {
            warRoomId: room.id,
            provisioningToken: expectedProvisioningToken,
            providerTenantId: slackWorkspaceId,
            channelId: altExisting.id,
            channelName: altExisting.name,
            channelUrl: warRoomUrl,
          })
        );
        if (adoption === 'READY') {
          await projectSlackWarRoomToLegacyIncident(room.id).catch(() => {});
          const { projectIncidentWarRoomParticipants } = await import('../../participant-desired-state');
          const { scheduleJob } = await import('@/lib/jobs/queue');
          const { requestSlackWarRoomProjection } = await import('./projection');
          await projectIncidentWarRoomParticipants(room.id);
          await scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId: room.id }, 5);
          await requestSlackWarRoomProjection(room.id).catch(() => {});
        }
        return;
      }
      // No channel found with planned name but Slack says name_taken —
      // another generation already owns the suffix or eventual consistency
      // lag. Fail closed; operator can reconcile by marker.
    }
  }

  if (!createResult.ok) {
    logger.error('[ChatOps] Failed to create Slack channel', {
      error: createResult.error,
      channelName: effectiveChannelName,
      incidentId: incident.id,
    });
    const errorMsg =
      createResult.error === 'missing_scope'
        ? "Slack app is missing the 'channels:manage' scope. Please re-authorize Slack in Settings > Slack to grant channel creation permissions."
        : `Slack API error: ${createResult.error}`;
    await markFailed(room.id, expectedProvisioningToken, 'SLACK_PROVISION_FAILED', errorMsg);
    return;
  }

  const channelId = createResult.channel?.id;
  if (!channelId) {
    await markFailed(room.id, expectedProvisioningToken, 'SLACK_PROVISION_FAILED', 'No channel ID returned from Slack');
    return;
  }

  // Best-effort side effects (topic, bridge) — do not fail provisioning if they fail.
  // The canonical command card is owned solely by WAR_ROOM_PROJECT (projection),
  // not by provisioning, to avoid dual owners and duplicate cards on retry.
  const appUrl = getBaseUrl();
  const dashboardUrl = `${appUrl}/incidents/${incident.id}`;
  const rawTopic = `🚨 ${incident.title} | ${incident.urgency} | ${dashboardUrl}`;
  const topicWithMarker = `${rawTopic} ${marker}`.slice(0, 250);
  await slackApiCall('conversations.setTopic', botToken, {
    channel: channelId,
    topic: topicWithMarker,
  }).catch(err => logger.warn('[ChatOps] Failed to set channel topic', { error: err }));
  // Also persist marker in purpose so marker scan can find the channel even if topic is edited.
  await slackApiCall('conversations.setPurpose', botToken, {
    channel: channelId,
    purpose: marker,
  }).catch(() => {});

  const videoBridge = incident.service.warRoomVideoBridge || config.defaultVideoBridge;
  const customUrl = incident.service.warRoomCustomBridgeUrl || config.customBridgeUrlTemplate;
  const warRoomUrl = generateBridgeUrl(incident.id, videoBridge, customUrl);

  // Welcome message is separate from the canonical card (which is projected via WAR_ROOM_PROJECT).
  const welcomeBlocks = [
    { type: 'header', text: { type: 'plain_text', text: '👋 Welcome to your Incident War Room!', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `This channel was automatically provisioned to coordinate resolution for *${incident.title}*.` } },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*⚡ War Room Power Features:*',
          '• 🔘 *1-Click Action Buttons*: Use *Acknowledge*, *Assign to Me*, or *Resolve* on the card above.',
          '• 📌 *Emoji Reaction Sync*: React to ANY message with 📌 (`:pushpin:`) or 📝 (`:memo:`) to auto-save to the incident timeline!',
          '• 📄 *Auto Postmortem*: Type `/incident postmortem` to generate a pre-filled Postmortem draft.',
        ].join('\n'),
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*💬 Quick Slash Commands:*',
          '`/incident ack` — Acknowledge incident',
          '`/incident resolve [summary]` — Resolve incident with notes',
          '`/incident note <message>` — Save a note to the timeline',
          '`/incident who` — View current on-call responders',
          '`/incident postmortem` — Create postmortem draft',
        ].join('\n'),
      },
    },
  ];
  await slackApiCall('chat.postMessage', botToken, {
    channel: channelId,
    blocks: welcomeBlocks,
    text: '👋 Welcome to your Incident War Room! Use 1-click buttons, 📌 emoji pins, or /incident slash commands.',
  }).catch(err => logger.warn('[ChatOps] Failed to post welcome card', { error: err }));

  const adoption = await runSerializableTransaction(tx =>
    adoptWarRoomChannel(tx, {
      warRoomId: room.id,
      provisioningToken: expectedProvisioningToken,
      providerTenantId: slackWorkspaceId,
      channelId,
      channelName: effectiveChannelName,
      channelUrl: warRoomUrl,
    })
  );

  if (adoption === 'FENCED') {
    logger.warn('[ChatOps] War-room completion lease was lost', { incidentId: incident.id, channelId });
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, provisioningToken: expectedProvisioningToken, state: { in: ['PROVISIONING', 'AMBIGUOUS'] } },
      data: { state: 'AMBIGUOUS', lastErrorCode: 'DATABASE_COMMIT_FAILED', lastError: 'Channel may have been created; reconcile by name before retrying.' },
    });
    return;
  }

  await projectSlackWarRoomToLegacyIncident(room.id).catch(() => {});
  if (adoption === 'CLOSED') {
    // Resolve won the race while Graph was in flight — the channel exists
    // provider-side but local state is CLOSED. Archive the late-created channel
    // so Slack does not drift open while Incident=RESOLVED.
    await slackApiCall('conversations.archive', botToken, { channel: channelId }).catch(() => {});
  } else if (adoption === 'CLOSING') {
    await ensureTerminalCloseHandoff(room.id, incident.id);
  } else if (adoption === 'READY') {
    const { projectIncidentWarRoomParticipants } = await import('../../participant-desired-state');
    const { scheduleJob } = await import('@/lib/jobs/queue');
    const { requestSlackWarRoomProjection } = await import('./projection');
    await projectIncidentWarRoomParticipants(room.id);
    await scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId: room.id }, 5);
    await requestSlackWarRoomProjection(room.id).catch(err =>
      logger.warn('[ChatOps] Failed to queue Slack projection', { error: err })
    );
  }

  await prisma.incidentEvent
    .create({
      data: {
        incidentId: incident.id,
        message: `War-room channel #${effectiveChannelName} created${warRoomUrl ? ` with video bridge` : ''}`,
      },
    })
    .catch(() => {});

  logger.info('[ChatOps] War-room provisioned', { incidentId: incident.id, channelId, channelName: effectiveChannelName });
}
