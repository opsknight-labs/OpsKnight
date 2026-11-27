/**
 * "Add responder" and "Reassign" from the incident card's More actions menu: a Slack modal with a
 * person picker, validated inline on submit, then queued as a durable ChatOps intent that runs the
 * lifecycle command as the person who clicked.
 */
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { normalizeError } from '@/lib/errors';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import { escapeSlack } from '@/lib/chatops/squire/render';
import { SLACK_MODAL_ACTIONS, type SlackModalAction } from '@/lib/chatops/slack-action-map';
import { resolveOpsKnightUser, workspaceBotToken } from '@/lib/chatops/slash-commands';
import {
  chatOpsLifecycleErrorMessage,
  executeChatOpsAssignment,
  executeChatOpsJoinResponder,
  executeChatOpsNote,
} from '@/lib/incidents/chatops-lifecycle';

export const SLACK_INCIDENT_MODAL_CALLBACK_IDS: Record<SlackModalAction, string> = {
  add_responder: 'opsknight_incident_add_responder',
  reassign: 'opsknight_incident_reassign',
};
const PERSON = { block: 'modal_person', action: 'value' } as const;
const NOTE = { block: 'modal_note', action: 'value' } as const;

const plain = (text: string) => ({ type: 'plain_text' as const, text: text.slice(0, 75) });

const metadataSchema = z.object({
  incidentId: z.string().min(1).max(64),
  channelId: z.string().max(64).optional(),
  messageTs: z.string().max(32).optional(),
  responseUrl: z.string().max(500).optional(),
});
type ModalMetadata = z.infer<typeof metadataSchema>;

const submissionSchema = z.object({
  personSlackId: z.string().regex(/^[UW][A-Z0-9]{2,20}$/, 'Pick a person.'),
  note: z.string().trim().max(1000).optional(),
});

export function buildIncidentActionModal(action: SlackModalAction, metadata: ModalMetadata) {
  const adding = action === 'add_responder';
  return {
    type: 'modal',
    callback_id: adding
      ? SLACK_INCIDENT_MODAL_CALLBACK_IDS.add_responder
      : SLACK_INCIDENT_MODAL_CALLBACK_IDS.reassign,
    title: plain(adding ? 'Add responder' : 'Reassign incident'),
    submit: plain(adding ? 'Add' : 'Reassign'),
    close: plain('Cancel'),
    private_metadata: JSON.stringify(metadata),
    blocks: [
      {
        type: 'input',
        block_id: PERSON.block,
        label: plain(adding ? 'Who should join?' : 'Reassign to'),
        element: {
          type: 'users_select',
          action_id: PERSON.action,
          placeholder: plain('Pick a person'),
        },
      },
      ...(adding
        ? [
            {
              type: 'input',
              block_id: NOTE.block,
              optional: true,
              label: plain('Note (optional)'),
              element: {
                type: 'plain_text_input',
                action_id: NOTE.action,
                multiline: true,
                max_length: 1000,
              },
            },
          ]
        : []),
    ],
  };
}

type BlockActionsPayload = {
  team?: { id?: unknown };
  trigger_id?: unknown;
  response_url?: unknown;
  channel?: { id?: unknown };
  container?: { channel_id?: unknown; message_ts?: unknown };
  actions?: Array<{ selected_option?: { value?: unknown } }>;
};

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined);

/**
 * Actions route: opens the modal inline, before any database work, because Slack's trigger_id is
 * only valid for three seconds. Refusals are ephemeral and never replace the card.
 */
export async function openIncidentActionModal(payload: BlockActionsPayload): Promise<Response> {
  const refuse = (text: string) =>
    Response.json({ response_type: 'ephemeral', replace_original: false, text });
  let selected: { action?: unknown; incidentId?: unknown } = {};
  try {
    selected = JSON.parse(asString(payload.actions?.[0]?.selected_option?.value) ?? '{}');
  } catch {
    // handled below
  }
  const action = SLACK_MODAL_ACTIONS.find(candidate => candidate === selected.action);
  const incidentId = asString(selected.incidentId);
  const teamId = asString(payload.team?.id);
  const triggerId = asString(payload.trigger_id);
  if (!action || !incidentId || !teamId || !triggerId) {
    return refuse('⚠️ This menu is no longer valid. Open the incident in OpsKnight.');
  }
  const metadata: ModalMetadata = {
    incidentId,
    ...(asString(payload.channel?.id ?? payload.container?.channel_id)
      ? { channelId: asString(payload.channel?.id ?? payload.container?.channel_id) }
      : {}),
    ...(asString(payload.container?.message_ts)
      ? { messageTs: asString(payload.container?.message_ts) }
      : {}),
    ...(asString(payload.response_url) ? { responseUrl: asString(payload.response_url) } : {}),
  };
  const fallback = refuse(
    '⚠️ Could not open the form. Try again, or use the incident in OpsKnight.'
  );
  try {
    const token = await workspaceBotToken(teamId);
    if (!token) return fallback;
    const response = await fetch('https://slack.com/api/views.open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        trigger_id: triggerId,
        view: buildIncidentActionModal(action, metadata),
      }),
      signal: AbortSignal.timeout(2_000),
    });
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (data.ok) return new Response(null, { status: 200 });
    logger.warn('[ChatOps] Slack incident modal did not open', { error: data.error });
    return fallback;
  } catch (error) {
    logger.warn('[ChatOps] Slack incident modal failed', {
      error: error instanceof Error ? error.name : 'error',
    });
    return fallback;
  }
}

type ViewValues = Record<string, Record<string, { value?: unknown; selected_user?: unknown }>>;

export function incidentModalActionForCallback(callbackId: unknown): SlackModalAction | null {
  return (
    (Object.entries(SLACK_INCIDENT_MODAL_CALLBACK_IDS).find(([, id]) => id === callbackId)?.[0] as
      SlackModalAction | undefined) ?? null
  );
}

/** Validates a submission; errors are keyed by block id, as Slack's `response_action: errors` wants. */
export function parseIncidentModalSubmission(values: ViewValues | undefined) {
  const read = (spec: { block: string; action: string }) => {
    const entry = Object.entries(values ?? {}).find(([id]) => id === spec.block)?.[1];
    const field = entry ? Object.values(entry)[0] : undefined;
    const raw = field?.selected_user ?? field?.value;
    return typeof raw === 'string' && raw ? raw : undefined;
  };
  const parsed = submissionSchema.safeParse({
    personSlackId: read(PERSON) ?? '',
    note: read(NOTE),
  });
  if (parsed.success) return { ok: true as const, value: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    errors[issue.path[0] === 'note' ? NOTE.block : PERSON.block] ??= issue.message;
  }
  return { ok: false as const, errors };
}

export interface IncidentModalSubmissionPayload {
  __kind: 'INCIDENT_MODAL_SUBMISSION';
  action: SlackModalAction;
  incidentId: string;
  personSlackId: string;
  note?: string;
  team_id: string;
  enterprise_id?: string;
  user_id: string;
  channel_id?: string;
  response_url?: string;
  __opsknightIntentId?: string;
}

/** Actions route: a `view_submission` for either modal. Invalid input is answered on the form. */
export async function acceptIncidentModalSubmission(
  action: SlackModalAction,
  payload: {
    team?: { id?: unknown };
    enterprise?: { id?: unknown } | null;
    user?: { id?: unknown };
    view?: { state?: { values?: ViewValues }; private_metadata?: unknown };
  },
  signature: string
): Promise<Response> {
  const parsed = parseIncidentModalSubmission(payload.view?.state?.values);
  if (!parsed.ok) return Response.json({ response_action: 'errors', errors: parsed.errors });
  const teamId = asString(payload.team?.id);
  const userId = asString(payload.user?.id);
  let metadata: ModalMetadata | null = null;
  try {
    const meta = metadataSchema.safeParse(
      JSON.parse(asString(payload.view?.private_metadata) ?? '')
    );
    if (meta.success) metadata = meta.data;
  } catch {
    // reported below
  }
  if (!teamId || !userId || !metadata) {
    return Response.json({
      response_action: 'errors',
      errors: { [PERSON.block]: 'This form expired. Close it and open it again from the card.' },
    });
  }
  const enterpriseId = asString(payload.enterprise?.id);
  const queued: IncidentModalSubmissionPayload = {
    __kind: 'INCIDENT_MODAL_SUBMISSION',
    action,
    incidentId: metadata.incidentId,
    personSlackId: parsed.value.personSlackId,
    ...(parsed.value.note ? { note: parsed.value.note } : {}),
    team_id: teamId,
    ...(enterpriseId ? { enterprise_id: enterpriseId } : {}),
    user_id: userId,
    ...(metadata.channelId ? { channel_id: metadata.channelId } : {}),
    ...(metadata.responseUrl ? { response_url: metadata.responseUrl } : {}),
  };
  try {
    await enqueueChatOpsIntent({
      kind: 'INTERACTIVE_ACTION',
      signature,
      workspaceId: teamId,
      channelId: metadata.channelId ?? '',
      slackUserId: userId,
      payload: { ...queued },
    });
  } catch (error) {
    logger.error('[ChatOps] Could not queue an incident modal submission', {
      error: error instanceof Error ? error.name : 'error',
    });
    return Response.json({
      response_action: 'errors',
      errors: { [PERSON.block]: 'OpsKnight could not save this right now. Try again.' },
    });
  }
  return new Response(null, { status: 200 });
}

const ephemeralReply = (text: string) => ({
  response_type: 'ephemeral' as const,
  replace_original: false,
  text,
});

/**
 * Worker: runs the lifecycle command as the person who submitted, with the normal permission
 * checks. The live card and its thread reply are refreshed by the command's own outbox effects.
 */
export async function handleIncidentModalSubmission(payload: IncidentModalSubmissionPayload) {
  const parsed = submissionSchema.safeParse({
    personSlackId: payload.personSlackId,
    note: payload.note,
  });
  const action = SLACK_MODAL_ACTIONS.find(a => a === payload.action);
  if (!parsed.success || !action || !payload.incidentId) {
    return ephemeralReply('⚠️ The form was incomplete.');
  }
  const workspace = { teamId: payload.team_id, enterpriseId: payload.enterprise_id || null };
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: payload.incidentId },
      select: {
        slackWorkspaceId: true,
        service: {
          select: { slackWorkspaceId: true, slackIntegration: { select: { workspaceId: true } } },
        },
      },
    });
    const incidentWorkspace =
      incident?.slackWorkspaceId ||
      incident?.service.slackIntegration?.workspaceId ||
      incident?.service.slackWorkspaceId;
    const { slackWorkspaceMatches } = await import('@/lib/slack/workspace-match');
    const inWorkspace = await slackWorkspaceMatches({
      teamId: payload.team_id,
      enterpriseId: payload.enterprise_id || null,
      incidentWorkspaceId: incidentWorkspace,
    });
    if (!incident || !inWorkspace) {
      return ephemeralReply('⚠️ Incident not found.');
    }
    const token = await workspaceBotToken(payload.team_id);
    const actor = token ? await resolveOpsKnightUser(payload.user_id, token, workspace) : null;
    if (!actor) {
      return ephemeralReply(
        '⚠️ Your Slack account is not linked to an active OpsKnight account. Match the email addresses before changing incidents.'
      );
    }
    const target = await resolveOpsKnightUser(parsed.data.personSlackId, token!, workspace);
    if (!target) {
      return ephemeralReply(
        `⚠️ <@${parsed.data.personSlackId}> is not linked to an active OpsKnight account (their emails must match), so nothing changed.`
      );
    }
    const idempotency = payload.__opsknightIntentId
      ? { key: payload.__opsknightIntentId, principalId: `chatops:${payload.user_id}` }
      : undefined;
    const common = {
      incidentId: payload.incidentId,
      actor: { id: actor.id, name: actor.name },
      targetUserId: target.id,
      provider: 'SLACK' as const,
      ...(idempotency ? { idempotency } : {}),
    };
    if (action === 'reassign') {
      const result = await executeChatOpsAssignment(common);
      return ephemeralReply(
        result.changed
          ? `🙋 Incident reassigned to *${escapeSlack(target.name)}*.`
          : `ℹ️ Incident is already assigned to *${escapeSlack(target.name)}*.`
      );
    }
    const result = await executeChatOpsJoinResponder(common);
    let noteFailed = false;
    if (result.changed && parsed.data.note) {
      try {
        await executeChatOpsNote({
          incidentId: payload.incidentId,
          actor: { id: actor.id, name: actor.name },
          content: `To ${target.name}: ${parsed.data.note}`,
          provider: 'SLACK',
          // Its own key, derived from the intent's, so a retry replays the join and the note once each.
          ...(idempotency
            ? {
                idempotency: {
                  key: `${idempotency.key}:note`,
                  principalId: idempotency.principalId,
                },
              }
            : {}),
        });
      } catch (noteError) {
        // A transient failure retries the whole intent (the join replays, the note is saved once).
        if (payload.__opsknightIntentId && normalizeError(noteError).retryable) throw noteError;
        // Otherwise the responder was added; say so instead of reporting the whole action as failed.
        logger.warn('[ChatOps] Responder note could not be saved', {
          incidentId: payload.incidentId,
          error: noteError,
        });
        noteFailed = true;
      }
    }
    return ephemeralReply(
      result.changed
        ? `➕ Added *${escapeSlack(target.name)}* as a responder.${noteFailed ? ' The note could not be saved.' : ''}`
        : `ℹ️ *${escapeSlack(target.name)}* is already a responder.`
    );
  } catch (error) {
    logger.warn('[ChatOps] Incident modal action rejected', {
      incidentId: payload.incidentId,
      error,
    });
    if (payload.__opsknightIntentId && normalizeError(error).retryable) throw error;
    return ephemeralReply(`⚠️ ${chatOpsLifecycleErrorMessage(error)}`);
  }
}
