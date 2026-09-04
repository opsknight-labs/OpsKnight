/**
 * Slack Interactive Actions API
 * Handles Slack button clicks for incident lifecycle actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifySlackSignature } from '@/lib/slack-signature';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsLifecycleCommand,
} from '@/lib/incidents/chatops-lifecycle';
import { runSerializableTransaction } from '@/lib/db-utils';
import { enqueueIncidentUpdateSideEffects } from '@/lib/event-outbox';

/**
 * Resolve the Slack user who pressed a button to an OpsKnight account and a
 * human-readable name.
 *
 * Slack renders `<@U0673U4TWAJ>` as a display name, but the incident timeline
 * stores raw text — so a mention written for Slack surfaces as the literal user
 * ID in the web UI. Callers need both forms, so this returns the name to use in
 * timeline entries while the Slack copy keeps the mention.
 */
async function resolveSlackActor(
  botToken: string | null,
  slackUserId?: string,
  slackUserName?: string
): Promise<{ opsUser: { id: string; name: string } | null; displayName: string }> {
  let slackRealName: string | undefined;
  let slackEmail: string | undefined;

  if (botToken && slackUserId) {
    try {
      const userRes = await fetch(
        `https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${botToken}` },
          signal: AbortSignal.timeout(750),
        }
      );
      const userData = await userRes.json();
      if (userData.ok && userData.user) {
        slackEmail = userData.user.profile?.email?.trim();
        slackRealName = (
          userData.user.profile?.real_name ||
          userData.user.real_name ||
          userData.user.name
        )?.trim();
      }
    } catch (e) {
      logger.warn('[Slack] Failed to fetch Slack user info', { error: e, slackUserId });
    }
  }

  let opsUser: { id: string; name: string } | null = null;

  if (slackEmail) {
    opsUser = await prisma.user.findFirst({
      where: {
        email: { equals: slackEmail, mode: 'insensitive' },
        status: 'ACTIVE',
      },
      select: { id: true, name: true },
    });
  }

  // Never falls back to an arbitrary account — an unresolved actor is named
  // from Slack only, and callers decide whether that is good enough.
  const displayName =
    opsUser?.name || slackRealName || slackUserName || slackUserId || 'an unknown user';

  return { opsUser, displayName };
}

type SlackActionPayload = {
  type?: string;
  challenge?: string;
  actions?: Array<{ value?: string; action_id?: string }>;
  user?: { id?: string; name?: string; username?: string };
  response_url?: string;
  container?: { channel_id?: string };
  channel?: { id?: string };
  team?: { id?: string };
  __opsknightIntentId?: string;
  [key: string]: unknown;
};

function lifecycleFailureResponse(error: unknown) {
  return NextResponse.json({
    response_type: 'ephemeral',
    text: `⚠️ ${chatOpsLifecycleErrorMessage(error)}`,
  });
}

export async function handleSlackActionRequest(payload: SlackActionPayload) {
  try {
    // Handle URL verification (for Slack app setup)
    if (payload.type === 'url_verification') {
      return NextResponse.json({ challenge: payload.challenge });
    }

    // Handle interactive button clicks
    if (payload.type === 'block_actions') {
      const action = payload.actions?.[0];
      if (!action) {
        return NextResponse.json({ error: 'No action found' }, { status: 400 });
      }

      const actionValue = JSON.parse(action.value || '{}');
      const { action: actionType, incidentId } = actionValue;
      const slackUserId = payload.user?.id;
      const slackUserName = payload.user?.name || payload.user?.username;
      const idempotency = payload.__opsknightIntentId
        ? { key: payload.__opsknightIntentId, principalId: `chatops:${slackUserId || 'unknown'}` }
        : undefined;

      if (!incidentId || !actionType) {
        return NextResponse.json({ error: 'Invalid action data' }, { status: 400 });
      }

      // Get incident context needed for Slack identity resolution and non-lifecycle actions.
      const incident = await prisma.incident.findUnique({
        where: { id: incidentId },
        include: { service: { select: { slackWorkspaceId: true, slackIntegration: { select: { workspaceId: true } } } } },
      });

      if (!incident) {
        return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
      }
      const workspaceId = payload.team?.id;
      const incidentWorkspaceId = incident.slackWorkspaceId || incident.service.slackIntegration?.workspaceId || incident.service.slackWorkspaceId;
      if (!workspaceId || !incidentWorkspaceId || workspaceId !== incidentWorkspaceId) {
        logger.warn('[Slack Actions] Rejected action from a different Slack workspace', {
          incidentId,
          workspaceId,
          incidentWorkspaceId,
        });
        return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
      }

      const { getSlackBotToken } = await import('@/lib/slack');
      const botToken = await getSlackBotToken(incident.serviceId);
      const { opsUser: actorUser, displayName: actorName } = await resolveSlackActor(
        botToken,
        slackUserId,
        slackUserName
      );
      if (!actorUser) {
        return NextResponse.json({
          response_type: 'ephemeral',
          text: '⚠️ Your Slack account is not linked to an active OpsKnight account. Match the email addresses before changing incidents.',
        });
      }

      // `responseMessage` goes back to Slack and keeps the <@ID> mention. Every
      // action below writes its own timeline entry atomically with its domain
      // command, so this route never writes one itself.
      let responseMessage = '';

      if (actionType === 'ack') {
        let result;
        try {
          result = await executeChatOpsLifecycleCommand({
            incidentId,
            command: 'ACKNOWLEDGE',
            actor: { id: actorUser.id, name: actorName },
            ...(idempotency ? { idempotency } : {}),
            eventMessage: `Acknowledged via Slack button by ${actorName}`,
          });
        } catch (error) {
          logger.warn('[Slack Actions] Acknowledge rejected', {
            incidentId,
            userId: actorUser.id,
            error,
          });
          return lifecycleFailureResponse(error);
        }

        if (!result.changed) {
          return NextResponse.json({
            text: `ℹ️ Incident is already ${result.status.toLowerCase()}`,
          });
        }

        responseMessage = `👀 Incident acknowledged by <@${slackUserId || 'responder'}>`;
      } else if (actionType === 'resolve') {
        let result;
        try {
          result = await executeChatOpsLifecycleCommand({
            incidentId,
            command: 'RESOLVE',
            actor: { id: actorUser.id, name: actorName },
            ...(idempotency ? { idempotency } : {}),
            eventMessage: `Resolved via Slack button by ${actorName}`,
          });
        } catch (error) {
          logger.warn('[Slack Actions] Resolve rejected', {
            incidentId,
            userId: actorUser.id,
            error,
          });
          return lifecycleFailureResponse(error);
        }

        if (!result.changed) {
          return NextResponse.json({
            text: 'ℹ️ Incident is already resolved',
          });
        }

        responseMessage = `✅ Incident resolved by <@${slackUserId || 'responder'}>`;
      } else if (actionType === 'assign_me') {
        if (slackUserId) {
          try {
            const { updateWarRoomTopic, slackApiCall } = await import('@/lib/chatops/war-room');

            // Direct invite Slack user into channel via slackUserId
            if (botToken && incident.slackChannelId) {
              await slackApiCall('conversations.invite', botToken, {
                channel: incident.slackChannelId,
                users: slackUserId,
              }).catch(() => {});
            }

            const targetUser = actorUser;

            // No "first active user" fallback: assigning the incident to an
            // arbitrary person is worse than not assigning it. Fail loudly.
            if (!targetUser) {
              logger.warn(
                '[Slack] assign_me could not resolve Slack user to an OpsKnight account',
                {
                  slackUserId,
                  slackUserName,
                  incidentId,
                }
              );
              return NextResponse.json({
                response_type: 'ephemeral',
                text: '⚠️ Could not match your Slack account to an OpsKnight user, so the incident was left unchanged. Make sure your Slack email matches your OpsKnight account email, then try again.',
              });
            }

            const assignmentChanged = await runSerializableTransaction(async tx => {
              const current = await tx.incident.findUnique({
                where: { id: incidentId },
                select: { assigneeId: true, teamId: true },
              });
              if (!current) throw new Error('Incident not found');
              if (current.assigneeId === targetUser.id && current.teamId === null) return false;

              await tx.incident.update({
                where: { id: incidentId },
                data: { assigneeId: targetUser.id, teamId: null },
              });
              await tx.incidentEvent.create({
                data: {
                  incidentId,
                  type: 'ASSIGNMENT',
                  message: `Assigned to ${targetUser.name} via Slack button`,
                },
              });
              await enqueueIncidentUpdateSideEffects(tx, incidentId, [
                'INCIDENT_ASSIGNED_TO_USER_NOTIFICATION',
              ]);
              return true;
            });
            updateWarRoomTopic(incidentId).catch(() => {});
            responseMessage = assignmentChanged
              ? `🙋 Incident assigned to *${targetUser.name}* (<@${slackUserId}>)`
              : `ℹ️ Incident is already assigned to *${targetUser.name}* (<@${slackUserId}>)`;
          } catch (err) {
            logger.warn('[Slack] Assign to Me failed', { error: err, incidentId });
            return NextResponse.json({
              response_type: 'ephemeral',
              text: '⚠️ Could not assign this incident. Please try again, or assign it from the OpsKnight incident page.',
            });
          }
        } else {
          return NextResponse.json({
            response_type: 'ephemeral',
            text: '⚠️ Could not identify your Slack user, so the incident was left unchanged.',
          });
        }
      } else if (actionType === 'snooze' || actionType === 'snooze_incident') {
        const snoozeMinutes =
          actionValue.minutes === undefined ? 60 : Number.parseInt(String(actionValue.minutes), 10);
        if (!Number.isInteger(snoozeMinutes) || snoozeMinutes <= 0) {
          return NextResponse.json({
            response_type: 'ephemeral',
            text: '⚠️ Snooze duration must be a positive number of minutes.',
          });
        }

        const snoozedUntil = new Date(Date.now() + snoozeMinutes * 60 * 1000);
        let result;
        try {
          result = await executeChatOpsLifecycleCommand({
            incidentId,
            command: 'SNOOZE',
            actor: { id: actorUser.id, name: actorName },
            ...(idempotency ? { idempotency } : {}),
            snoozedUntil,
            eventMessage: `Snoozed for ${snoozeMinutes}m via Slack button by ${actorName}`,
          });
        } catch (error) {
          logger.warn('[Slack Actions] Snooze rejected', {
            incidentId,
            userId: actorUser.id,
            error,
          });
          return lifecycleFailureResponse(error);
        }

        if (!result.changed) {
          return NextResponse.json({ text: 'ℹ️ Incident snooze is already applied' });
        }

        responseMessage = `💤 Incident snoozed for ${snoozeMinutes}m by <@${slackUserId || 'responder'}>`;
      } else if (actionType === 'escalate' || actionType === 'escalate_incident') {
        // A linked-and-active Slack account is not authorization on its own:
        // escalation pages other responders, so it goes through the same
        // incident-scoped check as any other transport.
        const { requestIncidentEscalation } = await import('@/lib/escalation/authorization');
        let escalation;
        try {
          escalation = await requestIncidentEscalation({
            incidentId,
            actor: { userId: actorUser.id, name: actorName },
            source: 'SLACK',
          });
        } catch (error) {
          logger.warn('[Slack Actions] Escalation rejected', {
            incidentId,
            userId: actorUser.id,
            error,
          });
          return NextResponse.json({
            response_type: 'ephemeral',
            text: '🚫 You do not have permission to escalate this incident.',
          });
        }

        if (!escalation.requested) {
          return NextResponse.json({
            response_type: 'ephemeral',
            text: 'ℹ️ This incident is no longer open, so there is nothing to escalate.',
          });
        }

        // The escalation command already recorded the request in the timeline
        // and the audit log.
        responseMessage = `⚡ Incident escalated by <@${slackUserId || 'responder'}>`;
      } else {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }

      return NextResponse.json({
        text: responseMessage,
        response_type: 'in_channel',
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    logger.error('[Slack] Actions API error', {
      error: error.message,
      stack: error.stack,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('x-slack-signature') || '';
  const timestamp = request.headers.get('x-slack-request-timestamp') || '';
  const verification = await verifySlackSignature(body, signature, timestamp);
  if (!verification.valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const params = new URLSearchParams(body);
    payload = body.startsWith('payload=')
      ? JSON.parse(params.get('payload') || '{}')
      : JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge });
  }

  const workspaceId = typeof payload.team?.id === 'string' ? payload.team.id : '';
  const channelId =
    typeof payload.channel?.id === 'string'
      ? payload.channel.id
      : typeof payload.container?.channel_id === 'string'
        ? payload.container.channel_id
        : '';
  const slackUserId = typeof payload.user?.id === 'string' ? payload.user.id : '';
  if (!workspaceId) return NextResponse.json({ error: 'Missing Slack workspace' }, { status: 400 });

  try {
    await enqueueChatOpsIntent({
      kind: 'INTERACTIVE_ACTION',
      signature,
      workspaceId,
      channelId,
      slackUserId,
      payload: { ...payload, __kind: 'INTERACTIVE_ACTION' },
    });
    // Slack requires acknowledgement within three seconds. The persisted
    // intent owns both execution and deferred response delivery.
    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error('[Slack] Actions API persistence error', { error });
    return NextResponse.json({ error: 'Unable to queue action' }, { status: 503 });
  }
}
