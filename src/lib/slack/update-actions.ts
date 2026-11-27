import 'server-only';
/**
 * SlackOps modals: "Update details" and "Post status update" (opened from the card's overflow menu),
 * their view_submission handling through the durable ChatOps intent path (same shape as the declare
 * modal), and the single hook the actions route calls for every SlackOps interaction.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { normalizeError } from '@/lib/errors';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import { chatOpsLifecycleErrorMessage } from '@/lib/incidents/chatops-lifecycle';
import {
  STATUS_MESSAGE_MAX,
  applyIncidentUpdate,
  postIncidentStatusUpdate,
  statusUpdateConfirmation,
  type IncidentUpdateChanges,
} from '@/lib/chatops/slash/update-commands';

export const SLACK_UPDATE_CALLBACK_ID = 'opsknight_incident_update';
export const SLACK_STATUS_CALLBACK_ID = 'opsknight_incident_status';
export const SLACKOPS_INTENT_KINDS: ReadonlySet<string> = new Set([
  'INCIDENT_UPDATE_SUBMISSION',
  'APP_HOME',
]);
const UPDATE_ACTION = 'update_details';
const STATUS_ACTION = 'status_update';
export const HOME_DECLARE_ACTION_ID = 'home_declare_incident';

const plain = (text: string) => ({ type: 'plain_text' as const, text: text.slice(0, 75) });

/** Option objects for the incident card's overflow menu (Slack caps an option value at 75 characters). */
export function buildUpdateOverflowOptions(incidentId: string) {
  return [
    { text: plain('Update details'), value: JSON.stringify({ action: UPDATE_ACTION, incidentId }) },
    {
      text: plain('Post status update'),
      value: JSON.stringify({ action: STATUS_ACTION, incidentId }),
    },
  ];
}

const BLOCK = {
  title: 'update_title',
  priority: 'update_priority',
  urgency: 'update_urgency',
  description: 'update_description',
  message: 'status_message',
  notify: 'status_notify',
} as const;

const PRIORITIES = [
  ['P1', 'P1 · Crisis'],
  ['P2', 'P2 · High'],
  ['P3', 'P3 · Medium'],
  ['P4', 'P4 · Low'],
  ['P5', 'P5 · Informational'],
] as const;
const URGENCIES = [
  ['HIGH', 'High'],
  ['MEDIUM', 'Medium'],
  ['LOW', 'Low'],
] as const;

type ModalIncident = {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  urgency: string;
};
type Metadata = { incidentId: string; responseUrl?: string };

const option = ([value, label]: readonly [string, string]) => ({ text: plain(label), value });

export function buildSlackUpdateModal(incident: ModalIncident, responseUrl?: string) {
  const priority = PRIORITIES.find(([value]) => value === incident.priority);
  const urgency = URGENCIES.find(([value]) => value === incident.urgency);
  const metadata: Metadata = { incidentId: incident.id, ...(responseUrl ? { responseUrl } : {}) };
  return {
    type: 'modal',
    callback_id: SLACK_UPDATE_CALLBACK_ID,
    title: plain('Update incident'),
    submit: plain('Save'),
    close: plain('Cancel'),
    private_metadata: JSON.stringify(metadata).slice(0, 3000),
    blocks: [
      {
        type: 'input',
        block_id: BLOCK.title,
        label: plain('Title'),
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          max_length: 200,
          initial_value: incident.title.slice(0, 200),
        },
      },
      {
        type: 'input',
        block_id: BLOCK.priority,
        optional: true,
        label: plain('Priority'),
        element: {
          type: 'static_select',
          action_id: 'value',
          ...(priority ? { initial_option: option(priority) } : {}),
          options: PRIORITIES.map(option),
        },
      },
      {
        type: 'input',
        block_id: BLOCK.urgency,
        label: plain('Urgency'),
        element: {
          type: 'static_select',
          action_id: 'value',
          ...(urgency ? { initial_option: option(urgency) } : {}),
          options: URGENCIES.map(option),
        },
      },
      {
        type: 'input',
        block_id: BLOCK.description,
        optional: true,
        label: plain('Description'),
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          max_length: 3000,
          ...(incident.description ? { initial_value: incident.description.slice(0, 3000) } : {}),
        },
      },
    ],
  };
}

export function buildSlackStatusModal(
  incident: { id: string; title: string },
  responseUrl?: string
) {
  const metadata: Metadata = { incidentId: incident.id, ...(responseUrl ? { responseUrl } : {}) };
  return {
    type: 'modal',
    callback_id: SLACK_STATUS_CALLBACK_ID,
    title: plain('Post status update'),
    submit: plain('Publish'),
    close: plain('Cancel'),
    private_metadata: JSON.stringify(metadata).slice(0, 3000),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Publishes on the status page(s) showing this service. Customer-facing, so write for customers.\n*${incident.title.replace(/[<>&*_`~]/g, '').slice(0, 150)}*`,
        },
      },
      {
        type: 'input',
        block_id: BLOCK.message,
        label: plain('Update'),
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          max_length: STATUS_MESSAGE_MAX,
        },
      },
      {
        type: 'input',
        block_id: BLOCK.notify,
        optional: true,
        label: plain('Subscribers'),
        element: {
          type: 'checkboxes',
          action_id: 'value',
          options: [{ text: plain('Also notify subscribers'), value: 'notify' }],
        },
      },
    ],
  };
}

type ViewState = {
  values?: Record<
    string,
    Record<
      string,
      {
        value?: unknown;
        selected_option?: { value?: unknown } | null;
        selected_options?: Array<{ value?: unknown }> | null;
      }
    >
  >;
};
type View = { callback_id?: unknown; state?: ViewState; private_metadata?: unknown };

function readField(view: View | undefined, block: string) {
  const entry = Object.entries(view?.state?.values ?? {}).find(([id]) => id === block)?.[1];
  return entry ? Object.values(entry)[0] : undefined;
}
const readString = (view: View | undefined, block: string): string | undefined => {
  const field = readField(view, block);
  const raw = field?.selected_option?.value ?? field?.value;
  return typeof raw === 'string' ? raw.trim() : undefined;
};

function readMetadata(view: View | undefined): Metadata | null {
  try {
    const raw =
      typeof view?.private_metadata === 'string' ? JSON.parse(view.private_metadata) : null;
    return raw && typeof raw.incidentId === 'string' && raw.incidentId
      ? {
          incidentId: raw.incidentId.slice(0, 64),
          ...(typeof raw.responseUrl === 'string'
            ? { responseUrl: raw.responseUrl.slice(0, 500) }
            : {}),
        }
      : null;
  } catch {
    return null;
  }
}

/** Validates an update-details submission; errors are keyed by block id for Slack's `errors` action. */
export function parseUpdateSubmission(
  view: View | undefined
): { ok: true; changes: IncidentUpdateChanges } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const title = readString(view, BLOCK.title) ?? '';
  if (title.length < 3 || title.length > 200) errors[BLOCK.title] = 'Use 3 to 200 characters.';
  const priority = readString(view, BLOCK.priority);
  if (priority && !PRIORITIES.some(([value]) => value === priority))
    errors[BLOCK.priority] = 'Pick P1 to P5.';
  const urgency = readString(view, BLOCK.urgency) ?? '';
  if (!URGENCIES.some(([value]) => value === urgency)) errors[BLOCK.urgency] = 'Pick an urgency.';
  const description = readString(view, BLOCK.description);
  if (description && description.length > 3000)
    errors[BLOCK.description] = 'Keep it under 3000 characters.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    changes: {
      title,
      urgency: urgency as 'LOW' | 'MEDIUM' | 'HIGH',
      ...(priority ? { priority } : {}),
      // An empty description is "leave it", not "clear it".
      ...(description ? { description } : {}),
    },
  };
}

export function parseStatusSubmission(
  view: View | undefined
): { ok: true; message: string; notify: boolean } | { ok: false; errors: Record<string, string> } {
  const message = readString(view, BLOCK.message) ?? '';
  if (message.length < 3 || message.length > STATUS_MESSAGE_MAX)
    return { ok: false, errors: { [BLOCK.message]: `Use 3 to ${STATUS_MESSAGE_MAX} characters.` } };
  const notify = Boolean(readField(view, BLOCK.notify)?.selected_options?.length);
  return { ok: true, message, notify };
}

type Interactive = {
  type?: unknown;
  trigger_id?: unknown;
  response_url?: unknown;
  team?: { id?: unknown };
  enterprise?: { id?: unknown } | null;
  user?: { id?: unknown };
  actions?: Array<{ value?: unknown; selected_option?: { value?: unknown } }>;
  view?: View;
};

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** The incident's workspace must match the signed one, like every other Slack action. */
async function loadIncidentForWorkspace(incidentId: string, teamId: string, enterpriseId: string) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      urgency: true,
      slackWorkspaceId: true,
      service: {
        select: { slackWorkspaceId: true, slackIntegration: { select: { workspaceId: true } } },
      },
    },
  });
  if (!incident) return null;
  const workspace =
    incident.slackWorkspaceId ||
    incident.service.slackIntegration?.workspaceId ||
    incident.service.slackWorkspaceId;
  // An Enterprise Grid org-wide install is stored under the enterprise id, so match through it too.
  const { slackWorkspaceMatches } = await import('@/lib/slack/workspace-match');
  return (await slackWorkspaceMatches({ teamId, enterpriseId, incidentWorkspaceId: workspace }))
    ? incident
    : null;
}

const ephemeralJson = (text: string) =>
  Response.json({ response_type: 'ephemeral', replace_original: false, text });

/** views.open FIRST thing the pressed modal action does; the only DB read is the prefill. */
async function openModalFromAction(
  kind: 'details' | 'status',
  incidentId: string,
  payload: Interactive
): Promise<Response> {
  const teamId = str(payload.team?.id);
  const triggerId = str(payload.trigger_id);
  if (!triggerId || !teamId) return ephemeralJson('⚠️ Could not open the form. Try again.');
  try {
    const { workspaceBotToken } = await import('@/lib/chatops/slash-commands');
    const [token, incident] = await Promise.all([
      workspaceBotToken(teamId),
      loadIncidentForWorkspace(incidentId, teamId, str(payload.enterprise?.id)),
    ]);
    if (!incident || !token) return ephemeralJson('⚠️ Incident not found.');
    const responseUrl = str(payload.response_url) || undefined;
    const { callSlackApi } = await import('@/lib/slack/api');
    const result = await callSlackApi(
      'views.open',
      token,
      {
        trigger_id: triggerId,
        view:
          kind === 'details'
            ? buildSlackUpdateModal(incident, responseUrl)
            : buildSlackStatusModal(incident, responseUrl),
      },
      { timeoutMs: 2_000 }
    );
    if (!result.ok) {
      logger.warn('[SlackOps] Modal did not open', { kind, error: result.error });
      return ephemeralJson('⚠️ Could not open the form. Try again.');
    }
    return new Response(null, { status: 200 });
  } catch (error) {
    logger.warn('[SlackOps] Modal failed', { kind, error: normalizeError(error).code });
    return ephemeralJson('⚠️ Could not open the form. Try again.');
  }
}

/**
 * The one hook of the actions route: returns a Response for any SlackOps interaction (modal openers,
 * shortcuts, our view submissions) or null so the normal dispatch continues.
 */
export async function handleSlackOpsInteractive(
  payload: Interactive,
  signature: string
): Promise<Response | null> {
  if (payload.type === 'message_action' || payload.type === 'shortcut') {
    const { handleSlackShortcut } = await import('@/lib/slack/shortcuts');
    return handleSlackShortcut(payload as Parameters<typeof handleSlackShortcut>[0]);
  }
  if (payload.type === 'block_actions') {
    const action = payload.actions?.[0];
    const raw = str(action?.value) || str(action?.selected_option?.value);
    if (!raw) return null;
    let parsed: { action?: unknown; incidentId?: unknown } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (parsed.action === 'declare_home') {
      const { openSlackDeclareModal } = await import('@/lib/chatops/slash-commands');
      const reply = await openSlackDeclareModal({
        team_id: str(payload.team?.id),
        trigger_id: str(payload.trigger_id),
      });
      return reply
        ? Response.json({ ...reply, replace_original: false })
        : new Response(null, { status: 200 });
    }
    const incidentId = str(parsed.incidentId);
    if (incidentId && (parsed.action === UPDATE_ACTION || parsed.action === STATUS_ACTION))
      return openModalFromAction(
        parsed.action === UPDATE_ACTION ? 'details' : 'status',
        incidentId,
        payload
      );
    return null;
  }
  if (payload.type === 'view_submission') {
    const callbackId = payload.view?.callback_id;
    if (callbackId === SLACK_UPDATE_CALLBACK_ID || callbackId === SLACK_STATUS_CALLBACK_ID)
      return acceptUpdateSubmission(payload, signature, callbackId === SLACK_STATUS_CALLBACK_ID);
  }
  return null;
}

async function acceptUpdateSubmission(
  payload: Interactive,
  signature: string,
  isStatus: boolean
): Promise<Response> {
  const parsed = isStatus
    ? parseStatusSubmission(payload.view)
    : parseUpdateSubmission(payload.view);
  if (!parsed.ok) return Response.json({ response_action: 'errors', errors: parsed.errors });
  const teamId = str(payload.team?.id);
  const userId = str(payload.user?.id);
  const metadata = readMetadata(payload.view);
  if (!teamId || !userId || !metadata)
    return Response.json({ error: 'Missing Slack workspace' }, { status: 400 });
  const enterpriseId = str(payload.enterprise?.id);
  try {
    await enqueueChatOpsIntent({
      kind: 'INTERACTIVE_ACTION',
      signature,
      workspaceId: teamId,
      channelId: '',
      slackUserId: userId,
      payload: {
        __kind: 'INCIDENT_UPDATE_SUBMISSION',
        op: isStatus ? 'status' : 'details',
        incidentId: metadata.incidentId,
        team_id: teamId,
        ...(enterpriseId ? { enterprise_id: enterpriseId } : {}),
        user_id: userId,
        ...(metadata.responseUrl ? { response_url: metadata.responseUrl } : {}),
        ...('changes' in parsed
          ? { changes: parsed.changes }
          : { message: parsed.message, notify: parsed.notify }),
      },
    });
  } catch (error) {
    logger.error('[SlackOps] Could not queue a submission', { error: normalizeError(error).code });
    const block = isStatus ? BLOCK.message : BLOCK.title;
    return Response.json({
      response_action: 'errors',
      errors: { [block]: 'OpsKnight could not save this right now. Try again.' },
    });
  }
  return new Response(null, { status: 200 });
}

type SubmissionPayload = {
  op: 'details' | 'status';
  incidentId: string;
  team_id: string;
  enterprise_id?: string;
  user_id: string;
  changes?: IncidentUpdateChanges;
  message?: string;
  notify?: boolean;
  __opsknightIntentId?: string;
};

const NOT_LINKED =
  '⚠️ Your Slack account is not linked to an active OpsKnight account. Match the email addresses before changing incidents.';

/** Worker: applies a queued submission as the linked Slack user; replies via the stored response_url. */
export async function processUpdateSubmission(payload: SubmissionPayload) {
  const reply = (text: string, inChannel = false) => ({
    response_type: inChannel ? ('in_channel' as const) : ('ephemeral' as const),
    replace_original: false,
    text,
  });
  const incident = await loadIncidentForWorkspace(
    String(payload.incidentId),
    String(payload.team_id)
  );
  if (!incident) return reply('⚠️ Incident not found.');
  try {
    const { workspaceBotToken, resolveOpsKnightUser } =
      await import('@/lib/chatops/slash-commands');
    const token = await workspaceBotToken(payload.team_id);
    const actor = token
      ? await resolveOpsKnightUser(payload.user_id, token, {
          teamId: payload.team_id,
          enterpriseId: payload.enterprise_id || null,
        })
      : null;
    if (!actor) return reply(NOT_LINKED);
    const name = actor.name ?? 'a teammate';
    if (payload.op === 'status') {
      const result = await postIncidentStatusUpdate({
        incidentId: incident.id,
        actor: { id: actor.id, name },
        message: String(payload.message ?? ''),
        notifySubscribers: payload.notify === true,
        ...(payload.__opsknightIntentId
          ? {
              idempotency: {
                key: payload.__opsknightIntentId,
                principalId: `chatops:${payload.user_id}`,
              },
            }
          : {}),
      });
      return result.ok
        ? reply(statusUpdateConfirmation(result.pages, name), true)
        : reply(`🚫 ${result.reason}`);
    }
    const { lines } = await applyIncidentUpdate({
      incidentId: incident.id,
      actor: { id: actor.id, name },
      changes: payload.changes ?? {},
      ...(payload.__opsknightIntentId
        ? {
            idempotency: {
              key: payload.__opsknightIntentId,
              principalId: `chatops:${payload.user_id}`,
            },
          }
        : {}),
    });
    return reply(lines.length ? `✏️ Saved: ${lines.join(' · ')}` : 'ℹ️ Nothing changed.');
  } catch (error) {
    logger.warn('[SlackOps] Update submission failed', { incidentId: incident.id, error });
    if (payload.__opsknightIntentId && normalizeError(error).retryable) throw error;
    return reply(`⚠️ ${chatOpsLifecycleErrorMessage(error)}`);
  }
}

/** Intent worker entry for every SlackOps kind. */
export async function processSlackOpsIntent(payload: Record<string, unknown>) {
  if (payload.__kind === 'APP_HOME') {
    const { processAppHome } = await import('@/lib/slack/home');
    return processAppHome(payload as Parameters<typeof processAppHome>[0]);
  }
  return processUpdateSubmission(payload as unknown as SubmissionPayload);
}
