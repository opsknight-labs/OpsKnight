/**
 * Run a runbook from Slack, safely: list -> Preview -> Confirm and run.
 *
 * Nothing starts from a first click. "Preview" asks the orchestrator for a plan digest plus a single-use,
 * actor-bound, five-minute preview authorization token (the same ones the incident page uses); only a
 * ready plan gets a "Confirm and run" button carrying both, and startRunbookExecution refuses a stale
 * digest or a reused token, so a double click cannot start two runs. Runbook steps that need approval
 * still wait for an approver exactly as when started from the web.
 */
import prisma from '@/lib/prisma';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { escapeSlack } from '@/lib/chatops/squire/render';
import { CAPABILITIES } from '@/lib/authorization';
import { actorHasCapability } from '@/lib/authorization-policy';
import { resolveUserActor } from '@/lib/authorization-actors';
import { authorizeChatOpsIncident } from '@/lib/incidents/chatops-lifecycle';
import { callSlackApi } from './api';

export const RUNBOOK_PREVIEW_ACTION = 'rb_preview';
export const RUNBOOK_RUN_ACTION = 'rb_run';
export const RUNBOOK_LIST_MAX = 5;

export const isRunbookAction = (action: string) =>
  action === RUNBOOK_PREVIEW_ACTION || action === RUNBOOK_RUN_ACTION;

type Reply = {
  response_type: 'in_channel' | 'ephemeral';
  replace_original?: false;
  text?: string;
  blocks?: unknown[];
};
const refuse = (text: string): Reply => ({
  response_type: 'ephemeral',
  replace_original: false,
  text: `⚠️ ${text}`,
});
const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** Same gate as the web actions: runbook.execute and view access to the incident. */
type RunbookAuth =
  | { error: string; actor?: undefined }
  | { error?: undefined; actor: NonNullable<Awaited<ReturnType<typeof resolveUserActor>>> };

async function authorize(incidentId: string, userId: string): Promise<RunbookAuth> {
  const actor = await resolveUserActor(userId);
  if (!actor || !actorHasCapability(actor, CAPABILITIES.RUNBOOK_EXECUTE)) {
    return { error: 'You do not have permission to run runbooks.' };
  }
  await authorizeChatOpsIncident(incidentId, userId, 'READ');
  return { actor };
}

/** Enabled bindings of the incident's service, i.e. what the incident page offers. */
async function loadRequest(incidentId: string, bindingId: string, userId: string) {
  const binding = await prisma.serviceAutomationRule.findFirst({
    where: { id: bindingId, enabled: true, service: { incidents: { some: { id: incidentId } } } },
    include: { runbook: { select: { name: true, publishedVersionId: true } } },
  });
  if (!binding) return null;
  return {
    name: binding.runbook.name,
    request: {
      runbookId: binding.runbookId,
      bindingId: binding.id,
      serviceId: binding.serviceId,
      incidentId,
      runbookVersionId:
        (binding.versionStrategy === 'PINNED'
          ? binding.runbookVersionId
          : binding.runbook.publishedVersionId) ?? undefined,
      triggeredByUserId: userId,
    },
  };
}

/** `/incident runbook`: ephemeral list with one Preview button each. */
export async function listIncidentRunbooks(incidentId: string, userId: string): Promise<Reply> {
  const auth = await authorize(incidentId, userId);
  if (auth.error !== undefined) return refuse(auth.error);
  const bindings = await prisma.serviceAutomationRule.findMany({
    where: {
      enabled: true,
      detachedAt: null,
      service: { incidents: { some: { id: incidentId } } },
      runbook: { archivedAt: null, publishedVersionId: { not: null } },
    },
    orderBy: { createdAt: 'asc' },
    take: RUNBOOK_LIST_MAX,
    select: { id: true, runbook: { select: { name: true } } },
  });
  if (bindings.length === 0) {
    return {
      response_type: 'ephemeral',
      text: 'No runbooks are attached to this incident’s service.',
    };
  }
  return {
    response_type: 'ephemeral',
    text: 'Runbooks for this incident',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Runbooks for this incident*\nPreview one to see its plan before anything runs.',
        },
      },
      ...bindings.map(binding => ({
        type: 'section',
        text: { type: 'mrkdwn', text: `• ${escapeSlack(clip(binding.runbook.name, 120))}` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Preview' },
          action_id: `${RUNBOOK_PREVIEW_ACTION}_${binding.id}`.slice(0, 255),
          value: JSON.stringify({
            action: RUNBOOK_PREVIEW_ACTION,
            incidentId,
            bindingId: binding.id,
          }),
        },
      })),
    ],
  };
}

type ButtonInput = {
  actionType: string;
  value: Record<string, unknown>;
  incidentId: string;
  actor: { id: string; name: string };
  serviceId: string;
  channelId?: string;
  slackUserId?: string;
};

export async function handleRunbookButton(input: ButtonInput): Promise<Reply> {
  const { value, incidentId, actor } = input;
  const bindingId = typeof value.bindingId === 'string' ? value.bindingId : '';
  if (!bindingId) return refuse('This button is no longer valid. Run `/incident runbook` again.');
  try {
    const auth = await authorize(incidentId, actor.id);
    if (auth.error !== undefined) return refuse(auth.error);
    const loaded = await loadRequest(incidentId, bindingId, actor.id);
    if (!loaded) return refuse('That runbook is no longer available for this incident.');
    return input.actionType === RUNBOOK_PREVIEW_ACTION
      ? await preview(input, loaded)
      : await confirmRun(input, loaded);
  } catch (error) {
    logger.warn('[Slack Runbook] Action failed', { incidentId, bindingId, error });
    const { toPublicAppError } = await import('@/lib/errors');
    return refuse(toPublicAppError(error).message);
  }
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

async function preview(input: ButtonInput, loaded: Loaded): Promise<Reply> {
  const { previewRunbookExecution } = await import('@/lib/runbooks/orchestrator');
  const plan = await previewRunbookExecution(loaded.request);
  const blocked = (plan.readiness ?? []).filter(check => check.state === 'blocked');
  const needsApproval = plan.steps.filter(step => step.requiresApproval).length;
  const lines = [
    `*${escapeSlack(clip(loaded.name, 120))}* · version ${plan.version} · ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}`,
    ...plan.steps
      .slice(0, 8)
      .map(
        step =>
          `• ${escapeSlack(clip(step.name, 80))} (${step.type}, risk ${step.risk})${step.requiresApproval ? ' — needs approval' : ''}`
      ),
    ...(plan.steps.length > 8 ? [`…and ${plan.steps.length - 8} more`] : []),
    ...(needsApproval
      ? [`${needsApproval} step(s) need approval; the run will wait for an approver in OpsKnight.`]
      : []),
    ...blocked.map(check => `🚫 ${escapeSlack(check.message)}`),
  ];
  const ready = blocked.length === 0 && !!plan.authorizationToken;
  return {
    response_type: 'ephemeral',
    replace_original: false,
    text: `Preview: ${loaded.name}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: clip(lines.join('\n'), 2900) } },
      ...(ready
        ? [
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  style: 'danger',
                  text: { type: 'plain_text', text: 'Confirm and run' },
                  action_id: `${RUNBOOK_RUN_ACTION}_${loaded.request.bindingId}`.slice(0, 255),
                  // 64-hex digest + 64-hex token: well under Slack's 2000-char limit.
                  value: JSON.stringify({
                    action: RUNBOOK_RUN_ACTION,
                    incidentId: input.incidentId,
                    bindingId: loaded.request.bindingId,
                    digest: plan.digest,
                    token: plan.authorizationToken,
                  }),
                },
              ],
            },
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: 'This confirmation expires in 5 minutes and works once.' },
              ],
            },
          ]
        : []),
    ],
  };
}

async function confirmRun(input: ButtonInput, loaded: Loaded): Promise<Reply> {
  const { digest, token } = input.value;
  if (
    typeof digest !== 'string' ||
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    return refuse('This confirmation is no longer valid. Preview the runbook again.');
  }
  const { startRunbookExecution } = await import('@/lib/runbooks/orchestrator');
  let execution;
  try {
    execution = await startRunbookExecution({
      ...loaded.request,
      expectedPlanDigest: digest,
      previewAuthorizationToken: token,
    });
  } catch (error) {
    // A reused (double click), expired or stale preview is refused by the orchestrator.
    if (/PREVIEW_(AUTHORIZATION_INVALID|STALE)/.test(String((error as Error)?.message))) {
      return refuse(
        'This preview was already used, expired or is out of date. Preview the runbook again.'
      );
    }
    throw error;
  }
  const url = `${getBaseUrl()}/runbooks/executions/${execution.id}`;
  const text = `▶️ *${escapeSlack(clip(loaded.name, 120))}* started by <@${input.slackUserId ?? 'responder'}> — <${url}|view execution>`;
  await postThreadReply(input, text);
  return { response_type: 'in_channel', replace_original: false, text };
}

/** Best effort: a missing card or Slack error never fails an already started run. */
async function postThreadReply(input: ButtonInput, text: string) {
  try {
    const card = await prisma.slackIncidentMessage.findFirst({
      where: { incidentId: input.incidentId, ts: { not: null }, channelId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { channelId: true, ts: true },
    });
    const { getSlackBotToken } = await import('@/lib/slack');
    const token = card ? await getSlackBotToken(input.serviceId) : null;
    if (!card || !token) return;
    await callSlackApi('chat.postMessage', token, {
      channel: card.channelId,
      thread_ts: card.ts,
      text,
    });
  } catch (error) {
    logger.warn('[Slack Runbook] Thread reply failed', { incidentId: input.incidentId, error });
  }
}
