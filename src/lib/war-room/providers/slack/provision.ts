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
import { slackApiCall } from './client';
import { generateBridgeUrl } from '../../bridge';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';

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

function isSlackRetryableError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes('rate_limited') ||
    lower.includes('ratelimited') ||
    lower.includes('429') ||
    lower.includes('http 429') ||
    lower.includes('http 5') ||
    lower.includes('timeout') ||
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  );
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
  const result = await slackApiCall('conversations.list', botToken, {
    exclude_archived: true,
    limit: 1000,
    types: 'public_channel,private_channel',
  });
  if (!result.ok) {
    if (isSlackRetryableError(result.error)) throw new WarRoomRetryableError(result.error ?? 'Slack list failed');
    return null;
  }
  return result.channels?.find(c => c.name === channelName) || null;
}

/** Worker entry point. Every retry reconciles this same generation before POST. */
export async function provisionSlackWarRoom(warRoomId: string, expectedProvisioningToken: string): Promise<void> {
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

  if (
    !room ||
    room.provisioningToken !== expectedProvisioningToken ||
    room.provider !== 'SLACK' ||
    !['PROVISIONING', 'AMBIGUOUS'].includes(room.state) ||
    !room.provisioningToken
  )
    return;

  const incident = room.incident;
  // Authority check before any Slack I/O
  const currentIncident = await prisma.incident.findUnique({
    where: { id: incident.id },
    select: { status: true, title: true, urgency: true },
  });
  if (!currentIncident || !['OPEN', 'ACKNOWLEDGED'].includes(currentIncident.status)) {
    if (room.state === 'AMBIGUOUS') return;
    await markFailed(room.id, expectedProvisioningToken, 'INCIDENT_NOT_ACTIVE', 'Incident is no longer active.');
    return;
  }

  const config = await prisma.chatOpsConfig.findUnique({ where: { id: 'default' } });
  if (!config?.enabled) {
    await markFailed(room.id, expectedProvisioningToken, 'CHATOPS_DISABLED', 'ChatOps is not enabled');
    return;
  }

  const botToken = await getSlackBotToken(incident.serviceId);
  if (!botToken) {
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
    await markFailed(room.id, expectedProvisioningToken, 'SLACK_WORKSPACE_MISSING', 'No Slack workspace installation configured');
    return;
  }

  const channelName = slackChannelName(config, incident.service.name, incident.id);

  // 1) Reconcile deterministic name before POST
  try {
    const existing = await findExistingChannel(botToken, channelName);
    if (existing) {
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
          channelId: existing.id,
          channelName: existing.name,
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
          data: { incidentId: incident.id, message: `War-room channel #${existing.name} reconciled` },
        }).catch(() => {});
      } else if (adoption === 'FENCED') {
        return;
      }
      return;
    }
  } catch (error) {
    if (error instanceof WarRoomRetryableError) throw error;
    // Non-retryable list failure already handled in findExistingChannel (returns null), so continue to create
  }

  // 2) Ambiguous gate: if we already attempted create, never blind POST again — reconcile only
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
            ? 'A prior Slack channel-create may have succeeded; reconciling by name only.'
            : 'Slack channel-create outcome remains unresolved after reconciliation window; operator reconciliation required.',
      },
    });
    if (remaining > 0) throw new WarRoomRetryableError('Reconciling ambiguous Slack channel-create by name only.', Math.min(60_000, remaining), true);
    if (remaining <= 0) {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken, state: 'AMBIGUOUS', createAttemptedAt: { not: null } },
        data: { state: 'FAILED', provisioningToken: null, lastErrorCode: 'CREATE_RECONCILIATION_EXHAUSTED', lastError: 'No Slack channel was found by name during reconciliation window.' },
      });
      await projectSlackWarRoomToLegacyIncident(room.id).catch(() => {});
    }
    return;
  }

  // 3) Fresh authority check right before POST
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

  let effectiveChannelName = channelName;
  let createResult = await slackApiCall('conversations.create', botToken, {
    name: effectiveChannelName,
    is_private: false,
  });

  if (!createResult.ok) {
    if (isSlackRetryableError(createResult.error)) {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, provisioningToken: expectedProvisioningToken },
        data: { state: 'AMBIGUOUS', lastErrorCode: 'SLACK_RATE_LIMITED', lastError: createResult.error ?? 'Slack rate limited' },
      });
      throw new WarRoomRetryableError(createResult.error ?? 'Slack rate limited');
    }

    // Reconcile deterministic name before second create on any failure
    const existingAfterFail = await findExistingChannel(botToken, channelName).catch(error => {
      if (error instanceof WarRoomRetryableError) throw error;
      return null;
    });
    if (existingAfterFail) {
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
          channelId: existingAfterFail.id,
          channelName: existingAfterFail.name,
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
          logger.warn('[ChatOps] Failed to queue Slack projection after fallback reconciliation', { error: err })
        );
      }
      return;
    }

    if (createResult.error === 'name_taken') {
      const suffix = Math.floor(Math.random() * 8999 + 1000).toString();
      effectiveChannelName = `${channelName.slice(0, 74)}-${suffix}`;
      createResult = await slackApiCall('conversations.create', botToken, {
        name: effectiveChannelName,
        is_private: false,
      });
      if (!createResult.ok && isSlackRetryableError(createResult.error)) {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, provisioningToken: expectedProvisioningToken },
          data: { state: 'AMBIGUOUS', lastErrorCode: 'SLACK_RATE_LIMITED', lastError: createResult.error ?? 'Slack rate limited' },
        });
        throw new WarRoomRetryableError(createResult.error ?? 'Slack rate limited');
      }
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

  // Best-effort side effects (topic, bridge, cards) — do not fail provisioning if they fail
  const appUrl = getBaseUrl();
  const dashboardUrl = `${appUrl}/incidents/${incident.id}`;
  const topic = `🚨 ${incident.title} | ${incident.urgency} | ${dashboardUrl}`;
  await slackApiCall('conversations.setTopic', botToken, {
    channel: channelId,
    topic: topic.slice(0, 250),
  }).catch(err => logger.warn('[ChatOps] Failed to set channel topic', { error: err }));

  const videoBridge = incident.service.warRoomVideoBridge || config.defaultVideoBridge;
  const customUrl = incident.service.warRoomCustomBridgeUrl || config.customBridgeUrlTemplate;
  const warRoomUrl = generateBridgeUrl(incident.id, videoBridge, customUrl);

  await enqueueCentralNotification({
    category: 'INCIDENT',
    channel: 'SLACK',
    recipientType: 'SLACK_CHANNEL',
    recipientAddress: channelId,
    incidentId: incident.id,
    templateKey: 'chatops-war-room-command-card',
    sourceType: 'INCIDENT',
    sourceId: incident.id,
    eventKey: `war-room:${channelId}:command-card`,
    displayMessage: `War-room command card for ${incident.title}`,
    priority: 1,
    payload: {
      kind: 'SLACK_CHANNEL',
      channel: channelId,
      incident: {
        id: incident.id,
        title: incident.title,
        status: incident.status,
        urgency: incident.urgency,
        serviceName: incident.service.name,
        assigneeName: incident.assignee?.name,
      },
      eventType: 'triggered',
      includeInteractiveButtons: true,
      serviceId: incident.serviceId,
      additionalMessage: warRoomUrl ? `📹 Video Bridge: ${warRoomUrl}` : undefined,
    },
  }).catch(err => logger.warn('[ChatOps] Failed to queue command card', { error: err }));

  // Welcome card
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
  if (adoption === 'READY') {
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
