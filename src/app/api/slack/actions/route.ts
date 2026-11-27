/**
 * Slack Interactive Actions API
 * Handles Slack button clicks for incident lifecycle actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import prisma from '@/lib/prisma';
import { trustedSlackEmail, type SlackWorkspaceRef } from '@/lib/chatops/slash-commands';
import { logger } from '@/lib/logger';
import { verifySlackSignature } from '@/lib/slack-signature';
import { normalizeError } from '@/lib/errors';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsLifecycleCommand,
} from '@/lib/incidents/chatops-lifecycle';
import { isOpsKnightIncidentCard } from '@/lib/slack/incident-card';

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
  workspace: SlackWorkspaceRef,
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
        // Only a confirmed, non-guest member of this signed workspace maps to an OpsKnight account by email.
        slackEmail = trustedSlackEmail(userData.user, workspace);
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
  actions?: Array<{
    value?: string;
    action_id?: string;
    action_ts?: string;
    selected_option?: { value?: string };
  }>;
  user?: { id?: string; name?: string; username?: string };
  response_url?: string;
  container?: { channel_id?: string; message_ts?: string };
  message?: unknown;
  channel?: { id?: string };
  team?: { id?: string };
  enterprise?: { id?: string } | null;
  __opsknightIntentId?: string;
  [key: string]: unknown;
};

/**
 * In the durable intent worker, a transient failure (DB timeout, serialization
 * conflict, internal error) must throw so the intent is retried instead of
 * recording a "try again" reply as the completed effect.
 */
function rethrowIfTransient(error: unknown, payload: SlackActionPayload): void {
  if (payload.__opsknightIntentId && normalizeError(error).retryable) throw error;
}

// Through response_url a reply without replace_original overwrites the clicked message, which wiped
// pinned war-room status cards whenever an action was refused.
function ephemeral(text: string) {
  return NextResponse.json({ response_type: 'ephemeral', replace_original: false, text });
}

/** Escalation failures, told apart so a timeout is not reported as a missing permission. */
function escalationFailureText(error: unknown): string {
  const normalized = normalizeError(error);
  if (normalized.status === 403) return '🚫 You do not have permission to escalate this incident.';
  if (normalized.status === 404) return '⚠️ Incident not found.';
  if (normalized.retryable || normalized.status >= 500) {
    return '⚠️ Could not escalate right now. Try again in a moment.';
  }
  return `⚠️ ${chatOpsLifecycleErrorMessage(error)}`;
}

function lifecycleFailureResponse(error: unknown) {
  return NextResponse.json({
    response_type: 'ephemeral',
    replace_original: false,
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
      // Buttons carry `value`; the snooze menu carries `selected_option.value`.
      const actionRawValue = action?.value ?? action?.selected_option?.value;
      // URL buttons (View Details) carry no value: nothing to do and nothing to reply.
      if (!action || !actionRawValue) return NextResponse.json(null);

      // Squire suggestion buttons carry a sealed proposal, not an incident action.
      const squire = await import('@/lib/chatops/squire/slack');
      if (squire.isSlackSquireAction(action.action_id)) {
        return NextResponse.json(
          await squire.handleSlackSquireButton(
            payload as Parameters<typeof squire.handleSlackSquireButton>[0]
          )
        );
      }

      let actionValue: Record<string, unknown>;
      try {
        actionValue = JSON.parse(actionRawValue);
      } catch {
        return ephemeral('⚠️ This button is no longer valid. Open the incident in OpsKnight.');
      }
      const actionType = typeof actionValue?.action === 'string' ? actionValue.action : '';
      const incidentId = typeof actionValue?.incidentId === 'string' ? actionValue.incidentId : '';
      const slackUserId = payload.user?.id;
      const slackUserName = payload.user?.name || payload.user?.username;
      const idempotency = payload.__opsknightIntentId
        ? { key: payload.__opsknightIntentId, principalId: `chatops:${slackUserId || 'unknown'}` }
        : undefined;

      if (!incidentId || !actionType) {
        return ephemeral('⚠️ This button is no longer valid. Open the incident in OpsKnight.');
      }

      // Get incident context needed for Slack identity resolution and non-lifecycle actions.
      const incident = await prisma.incident.findUnique({
        where: { id: incidentId },
        include: {
          service: {
            select: { slackWorkspaceId: true, slackIntegration: { select: { workspaceId: true } } },
          },
        },
      });

      if (!incident) {
        return ephemeral('⚠️ Incident not found.');
      }
      const workspaceId = payload.team?.id;
      const incidentWorkspaceId =
        incident.slackWorkspaceId ||
        incident.service.slackIntegration?.workspaceId ||
        incident.service.slackWorkspaceId;
      if (!workspaceId || !incidentWorkspaceId || workspaceId !== incidentWorkspaceId) {
        logger.warn('[Slack Actions] Rejected action from a different Slack workspace', {
          incidentId,
          workspaceId,
          incidentWorkspaceId,
        });
        return ephemeral('⚠️ Incident not found.');
      }

      const { getSlackBotToken } = await import('@/lib/slack');
      const botToken = await getSlackBotToken(incident.serviceId);
      const { opsUser: actorUser, displayName: actorName } = await resolveSlackActor(
        botToken,
        {
          teamId: workspaceId,
          enterpriseId: typeof payload.enterprise?.id === 'string' ? payload.enterprise.id : null,
        },
        slackUserId,
        slackUserName
      );
      if (!actorUser) {
        return NextResponse.json({
          response_type: 'ephemeral',
          replace_original: false,
          text: '⚠️ Your Slack account is not linked to an active OpsKnight account. Match the email addresses before changing incidents.',
        });
      }

      // On an OpsKnight incident card the reply replaces the card with its fresh state and the
      // clicker gets an ephemeral confirmation; anywhere else (war-room cards, older cards) the
      // text reply below is posted as before.
      const reply = async (text: string, fallback: () => NextResponse): Promise<NextResponse> => {
        if (!isOpsKnightIncidentCard(payload.message)) return fallback();
        try {
          const { refreshedIncidentCardResponse } = await import('@/lib/slack/card-response');
          const replaced = await refreshedIncidentCardResponse({
            incidentId,
            serviceId: incident.serviceId,
            message: payload.message,
            channelId: payload.channel?.id || payload.container?.channel_id,
            slackUserId,
            confirmation: text,
          });
          if (replaced) return NextResponse.json(replaced);
        } catch (error) {
          logger.warn('[Slack Actions] Card refresh failed', { incidentId, error });
        }
        return fallback();
      };

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
          rethrowIfTransient(error, payload);
          return lifecycleFailureResponse(error);
        }

        if (!result.changed) {
          const text = `ℹ️ Incident is already ${result.status.toLowerCase()}`;
          return reply(text, () => NextResponse.json({ text }));
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
          rethrowIfTransient(error, payload);
          return lifecycleFailureResponse(error);
        }

        if (!result.changed) {
          const text = 'ℹ️ Incident is already resolved';
          return reply(text, () => NextResponse.json({ text }));
        }

        responseMessage = `✅ Incident resolved by <@${slackUserId || 'responder'}>`;
      } else if (actionType === 'assign_me') {
        if (slackUserId) {
          try {
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
                replace_original: false,
                text: '⚠️ Could not match your Slack account to an OpsKnight user, so the incident was left unchanged. Make sure your Slack email matches your OpsKnight account email, then try again.',
              });
            }

            const { executeChatOpsCommand } = await import('@/lib/chatops/commands');
            const assignment = (await executeChatOpsCommand({
              provider: 'SLACK',
              actor: { id: actorUser.id, name: targetUser.name },
              command: { kind: 'ASSIGN', incidentId, targetUserId: targetUser.id },
              ...(idempotency ? { idempotency } : {}),
            })) as { changed: boolean };
            responseMessage = assignment.changed
              ? `🙋 Incident assigned to *${targetUser.name}* (<@${slackUserId}>)`
              : `ℹ️ Incident is already assigned to *${targetUser.name}* (<@${slackUserId}>)`;
          } catch (err) {
            logger.warn('[Slack] Assign to Me failed', { error: err, incidentId });
            rethrowIfTransient(err, payload);
            // Show the real reason (e.g. missing permission) instead of a misleading "try again".
            return lifecycleFailureResponse(err);
          }
        } else {
          return NextResponse.json({
            response_type: 'ephemeral',
            replace_original: false,
            text: '⚠️ Could not identify your Slack user, so the incident was left unchanged.',
          });
        }
      } else if (actionType === 'take_command') {
        try {
          const { executeChatOpsCommand } = await import('@/lib/chatops/commands');
          const role = (await executeChatOpsCommand({
            provider: 'SLACK',
            actor: { id: actorUser.id, name: actorName },
            command: {
              kind: 'SET_ROLE',
              incidentId,
              roleKey: 'COMMANDER',
              targetUserId: actorUser.id,
            },
            ...(idempotency ? { idempotency } : {}),
          })) as { changed: boolean };
          responseMessage = role.changed
            ? `🎖️ <@${slackUserId || 'responder'}> took command of this incident`
            : `ℹ️ <@${slackUserId || 'responder'}> is already the incident commander`;
        } catch (err) {
          logger.warn('[Slack] Take command failed', { error: err, incidentId });
          rethrowIfTransient(err, payload);
          return lifecycleFailureResponse(err);
        }
      } else if (actionType === 'snooze' || actionType === 'snooze_incident') {
        const snoozeMinutes =
          actionValue.minutes === undefined ? 60 : Number.parseInt(String(actionValue.minutes), 10);
        if (!Number.isInteger(snoozeMinutes) || snoozeMinutes <= 0 || snoozeMinutes > 10_080) {
          return NextResponse.json({
            response_type: 'ephemeral',
            replace_original: false,
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
          rethrowIfTransient(error, payload);
          return lifecycleFailureResponse(error);
        }

        if (!result.changed) {
          const text = 'ℹ️ Incident snooze is already applied';
          return reply(text, () => NextResponse.json({ text }));
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
          rethrowIfTransient(error, payload);
          return ephemeral(escalationFailureText(error));
        }

        if (!escalation.requested) {
          return ephemeral(
            escalation.reason === 'INCIDENT_NOT_FOUND'
              ? '⚠️ Incident not found.'
              : 'ℹ️ This incident is no longer open, so there is nothing to escalate.'
          );
        }

        // The channel cards (Slack and Teams) are refreshed by requestIncidentEscalation itself
        // (escalation/chat-card-refresh), the same as escalations from the web, API or the engine.

        // The escalation command already recorded the request in the timeline
        // and the audit log.
        responseMessage = `⚡ Incident escalated by <@${slackUserId || 'responder'}>`;
      } else {
        return ephemeral('⚠️ This action is not supported.');
      }

      return reply(responseMessage, () =>
        NextResponse.json({
          text: responseMessage,
          response_type: 'in_channel',
        })
      );
    }

    return NextResponse.json({ ok: true });
  } catch (caught: unknown) {
    const error = caught as Error;
    logger.error('[Slack] Actions API error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Worker mode: fail the intent so it is retried rather than completed with an error body.
    if (payload.__opsknightIntentId) throw error;
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
  // SlackOps: shortcuts, update/status modals (opened inline for trigger_id), Home "Declare".
  {
    const { handleSlackOpsInteractive } = await import('@/lib/slack/update-actions');
    const handled = await handleSlackOpsInteractive(payload, signature);
    if (handled) return handled;
  }
  // `/incident declare` modal submit: validated inline (errors show on the form), then queued.
  if (
    payload.type === 'view_submission' &&
    payload.view?.callback_id === 'opsknight_incident_declare'
  ) {
    const { acceptSlackDeclareSubmission } = await import('@/lib/chatops/slash-commands');
    return acceptSlackDeclareSubmission(payload, signature);
  }
  // URL buttons (View Details) only open a link; there is no effect to queue.
  if (
    payload.type === 'block_actions' &&
    !payload.actions?.[0]?.value &&
    !payload.actions?.[0]?.selected_option?.value
  ) {
    return new Response(null, { status: 200 });
  }

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
