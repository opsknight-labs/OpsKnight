/**
 * Slack Interactive Actions API
 * Handles Slack button clicks for incident lifecycle actions
 */

import { after, NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { toSlackResponseUrl, verifySlackSignature } from '@/lib/slack-signature';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsLifecycleCommand,
} from '@/lib/incidents/chatops-lifecycle';

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

      if (!incidentId || !actionType) {
        return NextResponse.json({ error: 'Invalid action data' }, { status: 400 });
      }

      // Get incident context needed for Slack identity resolution and non-lifecycle actions.
      const incident = await prisma.incident.findUnique({
        where: { id: incidentId },
      });

      if (!incident) {
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

      // Two variants of every message: `responseMessage` goes to Slack and keeps
      // the <@ID> mention; `timelineMessage` is plain text for non-lifecycle
      // actions. Lifecycle actions write their timeline entry and durable
      // external side effects atomically in the centralized lifecycle engine.
      let responseMessage = '';
      let timelineMessage = '';
      let lifecycleRecordedTimeline = false;
      let notifyNonLifecycleUpdate = false;

      if (actionType === 'ack') {
        let result;
        try {
          result = await executeChatOpsLifecycleCommand({
            incidentId,
            command: 'ACKNOWLEDGE',
            actor: { id: actorUser.id, name: actorName },
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
        lifecycleRecordedTimeline = true;
      } else if (actionType === 'resolve') {
        let result;
        try {
          result = await executeChatOpsLifecycleCommand({
            incidentId,
            command: 'RESOLVE',
            actor: { id: actorUser.id, name: actorName },
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
        lifecycleRecordedTimeline = true;
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

            await prisma.incident.update({
              where: { id: incidentId },
              data: { assigneeId: targetUser.id, teamId: null },
            });
            updateWarRoomTopic(incidentId).catch(() => {});
            responseMessage = `🙋 Incident assigned to *${targetUser.name}* (<@${slackUserId}>)`;
            timelineMessage = `Assigned to ${targetUser.name} via Slack button`;
            notifyNonLifecycleUpdate = true;
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
        lifecycleRecordedTimeline = true;
      } else if (actionType === 'escalate' || actionType === 'escalate_incident') {
        const { executeEscalation } = await import('@/lib/escalation');
        await executeEscalation(incidentId);
        responseMessage = `⚡ Incident escalated by <@${slackUserId || 'responder'}>`;
        timelineMessage = `Escalated via Slack button by ${actorName}`;
        notifyNonLifecycleUpdate = true;
      } else {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }

      // Non-lifecycle actions still own their timeline entry here. Lifecycle
      // actions already wrote it atomically with the state transition.
      if (!lifecycleRecordedTimeline && timelineMessage) {
        await prisma.incidentEvent
          .create({
            data: {
              incidentId,
              message: timelineMessage,
            },
          })
          .catch(() => {});
      }

      // Assignment/escalation are not lifecycle transitions and retain their
      // existing immediate notification path. Lifecycle delivery is outboxed.
      if (notifyNonLifecycleUpdate) {
        import('@/lib/user-notifications')
          .then(({ sendIncidentNotifications }) => sendIncidentNotifications(incidentId, 'updated'))
          .catch(err =>
            logger.error('[Slack] Failed to send notifications for button action', {
              error: err instanceof Error ? err.message : String(err),
              incidentId,
              actionType,
            })
          );
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

  const responseUrl = toSlackResponseUrl(payload.response_url);
  after(async () => {
    const result = await handleSlackActionRequest(payload);
    if (!responseUrl) return;
    try {
      const responsePayload = await result.json();
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(responsePayload),
      });
    } catch (error) {
      logger.error('[Slack] Failed to deliver deferred action response', { error });
    }
  });

  // Slack requires acknowledgement within three seconds. All mutations and
  // follow-up delivery run in Next.js `after`, which survives this response.
  return new Response(null, { status: 200 });
}
