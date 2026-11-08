import 'server-only';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  assertCanAddIncidentNote,
  assertCanViewIncident,
  assertCapability,
  assertResponderOrAbove,
  getCurrentUser,
} from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { addIncidentNoteDomainCommand } from '@/lib/incidents/notes';
import { assignIncidentDomainCommand } from '@/lib/incidents/assignment';
import { resolveIncidentWithNote, updateIncidentStatus } from '@/lib/incidents/operator-lifecycle';
import { decideRelationship, linkIncidents } from '../../correlation/commands';
import { authorizeChatOpsIncidentInTransaction } from '@/lib/incidents/chatops-lifecycle';
import {
  executeIdempotentIncidentLifecycleCommand,
  transitionIncidentToStatusIdempotent,
} from '@/lib/incidents/idempotent-commands';
import { readIncidentForActor } from '../deterministic';
import { recordServiceFactCommand } from '../../memory/facts';
import {
  SNAPSHOT_FREE_ACTIONS,
  SQUIRE_ACTION_INPUTS,
  SQUIRE_ACTION_KIND,
  type SquireActionInput,
} from './catalog';
import { buildProposal, openProposal, type OpenedProposal } from './proposals';
import { isExtendedSquireAction, type ExtendedSquireActionName } from './catalog-extended';
import { checkExtendedPreconditions, extendedActionsAvailable } from './extended';
import {
  readSquireActionOutcome,
  UNKNOWN_ACTION_MESSAGE,
  type SquireActionResult,
} from './outcomes';
export type { SquireActionResult } from './outcomes';

const failed = (message: string): SquireActionResult => ({ ok: false, message });

/**
 * Runs an action the signed-in person confirmed. This is the only place an assistant proposal turns into a
 * change, and it adds nothing of its own: each action calls the same domain command, with the same
 * permission checks, as the matching control in the application, under the person's own session. On top of
 * that it requires the proposal to be theirs, unexpired and unused, and the incident still readable to them.
 * Every attempt is audited.
 */
export async function executeSquireAction(
  actor: AuthorizationActor,
  token: string,
  /** Set when the confirmation came from a linked chat account rather than the signed-in browser. */
  channel?: SquireConfirmChannel
): Promise<SquireActionResult> {
  if (actor.apiKey || actor.status !== 'ACTIVE') return failed('Sign in to confirm this action.');
  const proposal = await openProposal(token, actor.id);
  if (!proposal) return failed('This suggestion has expired. Ask again for a fresh one.');
  if (SQUIRE_ACTION_KIND[proposal.action] !== 'WRITE')
    return failed('Nothing to confirm for this suggestion.');
  const parsed = SQUIRE_ACTION_INPUTS[proposal.action].safeParse(proposal.input);
  if (!parsed.success) return failed('This suggestion is no longer valid.');
  if (!SNAPSHOT_FREE_ACTIONS.has(proposal.action) && !proposal.preconditions)
    return failed('This suggestion needs a fresh review. Ask again for a new suggestion.');
  // Extended actions stay opt-in at confirmation time too: switching them off withdraws open cards.
  if (
    isExtendedSquireAction(proposal.action) &&
    !(await extendedActionsAvailable(actor, proposal.action, { followUp: true }))
  )
    return failed('This kind of action is turned off. Ask an administrator to enable it.');
  const incidentId = (parsed.data as { incidentId: string }).incidentId;
  if (!(await readIncidentForActor(actor, incidentId)))
    return failed('That incident is not available to you.');

  // Single use: the receipt is written before the change, so a double click or a replayed request is refused.
  try {
    await prisma.squireActionReceipt.create({
      data: {
        id: proposal.id,
        userId: actor.id,
        action: proposal.action,
        incidentId,
        status: 'RESERVED',
        intentEncrypted: await encrypt(
          JSON.stringify({
            v: 1,
            action: proposal.action,
            input: parsed.data,
            preconditions: proposal.preconditions,
          })
        ),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const outcome = await readSquireActionOutcome(actor, proposal.id);
      return outcome?.result ?? failed(outcome?.message ?? UNKNOWN_ACTION_MESSAGE);
    }
    throw error;
  }

  const audit = (outcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN', tx?: Prisma.TransactionClient) => {
    const writing = logAudit(
      {
        action: 'intelligence.squire.action',
        entityType: 'INCIDENT',
        entityId: incidentId,
        actorId: actor.id,
        source: channel ? 'INTEGRATION' : 'UI',
        details: {
          squireAction: proposal.action,
          proposalId: proposal.id,
          outcome,
          ...(channel ? { channel: channel.provider } : {}),
        },
      },
      tx
    );
    return tx ? writing : writing.catch(() => undefined);
  };

  try {
    await prisma.squireActionReceipt.update({
      where: { id: proposal.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    const complete: Complete = async (tx, message, followUp) => {
      await tx.squireActionReceipt.update({
        where: { id: proposal.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          resultEncrypted: await encrypt(
            JSON.stringify({
              ok: true,
              message,
              href: `/incidents/${encodeURIComponent(incidentId)}`,
              ...(followUp ? { followUp } : {}),
            })
          ),
        },
      });
      await audit('SUCCEEDED', tx);
    };
    // A chat confirmation runs only the core actions that have a chat path (runFromChat refuses the rest
    // and asks the person to confirm in the application); extended actions need the web session.
    const { message, followUp } = channel
      ? {
          message: await runFromChat(
            actor,
            channel,
            proposal.action as WriteAction,
            parsed.data as never,
            proposal.id,
            complete,
            tx => checkPreconditions(tx, proposal, incidentId)
          ),
          followUp: undefined,
        }
      : isExtendedSquireAction(proposal.action)
        ? await runExtended(
            actor,
            proposal,
            parsed.data as Record<string, unknown>,
            incidentId,
            complete
          )
        : {
            message: await run(
              actor,
              proposal.action as WriteAction,
              parsed.data as never,
              proposal.id,
              complete,
              tx => checkPreconditions(tx, proposal, incidentId)
            ),
            followUp: undefined,
          };
    try {
      revalidatePath(`/incidents/${incidentId}`);
    } catch {
      logger.warn('[Squire] Action succeeded; page refresh failed', { action: proposal.action });
    }
    return {
      ok: true,
      message,
      href: `/incidents/${encodeURIComponent(incidentId)}`,
      ...(followUp ? { followUp } : {}),
    };
  } catch (error) {
    // A lost commit response must not erase an atomically persisted success.
    const known = await readSquireActionOutcome(actor, proposal.id).catch(() => null);
    if (known?.status === 'SUCCEEDED' && known.result) return known.result;
    const rejected = error instanceof AppError;
    const result = failed(rejected ? error.userMessage : UNKNOWN_ACTION_MESSAGE);
    await prisma.squireActionReceipt.updateMany({
      where: { id: proposal.id, status: { in: ['RESERVED', 'RUNNING'] } },
      data: {
        status: rejected ? 'FAILED' : 'UNKNOWN',
        completedAt: new Date(),
        failureCode: rejected ? 'DOMAIN_REJECTED' : 'EXECUTION_UNCERTAIN',
        resultEncrypted: rejected ? await encrypt(JSON.stringify(result)) : null,
      },
    });
    await audit(rejected ? 'FAILED' : 'UNKNOWN');
    logger.warn('[Squire] Confirmed action did not return a known success', {
      action: proposal.action,
      error: error instanceof Error ? error.name : 'error',
    });
    return result;
  }
}

type WriteAction = Exclude<
  keyof typeof SQUIRE_ACTION_INPUTS,
  'open_runbook' | 'draft_postmortem' | ExtendedSquireActionName
>;
type FollowUp = Extract<SquireActionResult, { ok: true }>['followUp'];
type Complete = (
  tx: Prisma.TransactionClient,
  message: string,
  followUp?: FollowUp
) => Promise<void>;

async function run<N extends WriteAction>(
  actor: AuthorizationActor,
  action: N,
  input: SquireActionInput<N>,
  proposalId: string,
  complete: Complete,
  beforeTx: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<string> {
  switch (action) {
    case 'acknowledge_incident': {
      const { incidentId } = input as SquireActionInput<'acknowledge_incident'>;
      await updateIncidentStatus(
        incidentId,
        'ACKNOWLEDGED',
        'OPEN',
        'WEB',
        {
          key: `squire:${proposalId}`,
          principalId: actor.id,
        },
        { beforeTx, inTx: tx => complete(tx, 'Incident acknowledged.') }
      );
      return 'Incident acknowledged.';
    }
    case 'resolve_incident': {
      const { incidentId, resolution } = input as SquireActionInput<'resolve_incident'>;
      await resolveIncidentWithNote(
        incidentId,
        resolution,
        'WEB',
        {
          key: `squire:${proposalId}`,
          principalId: actor.id,
        },
        { beforeTx, inTx: tx => complete(tx, 'Incident resolved.') }
      );
      return 'Incident resolved.';
    }
    case 'add_incident_note': {
      const { incidentId, content } = input as SquireActionInput<'add_incident_note'>;
      await assertCanAddIncidentNote(incidentId);
      const user = await getCurrentUser();
      if (user.id !== actor.id) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
      await prisma.$transaction(
        async tx => {
          await addIncidentNoteDomainCommand(
            {
              incidentId,
              content,
              actor: { id: user.id, name: user.name },
            },
            tx
          );
          await complete(tx, 'Note added.');
        },
        { isolationLevel: 'Serializable' }
      );
      return 'Note added.';
    }
    case 'reassign_incident': {
      const { incidentId, assigneeId } = input as SquireActionInput<'reassign_incident'>;
      const responder = await assertResponderOrAbove();
      if (responder.id !== actor.id) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
      await prisma.$transaction(
        async tx => {
          await beforeTx(tx);
          await assignIncidentDomainCommand(
            { incidentId, assigneeId, actor: { id: responder.id, name: responder.name } },
            tx
          );
          await complete(tx, 'Incident reassigned.');
        },
        { isolationLevel: 'Serializable' }
      );
      return 'Incident reassigned.';
    }
    case 'link_related_incident': {
      const { incidentId, otherIncidentId, note } =
        input as SquireActionInput<'link_related_incident'>;
      await prisma.$transaction(
        async tx => {
          await beforeTx(tx);
          await linkIncidents(
            actor,
            { incidentId, otherIncidentId, ...(note ? { note } : {}) },
            tx
          );
          await complete(tx, 'Incidents marked as related.');
        },
        { isolationLevel: 'Serializable' }
      );
      return 'Incidents marked as related.';
    }
    case 'learn_service_fact': {
      // The knowledge command re-checks the switch, the incident, the curator's rights and the fact itself.
      const { incidentId, fact } = input as SquireActionInput<'learn_service_fact'>;
      await prisma.$transaction(
        async tx => {
          await recordServiceFactCommand(actor, { incidentId, fact, proposalId }, tx);
          await complete(tx, 'Saved to Squire’s knowledge for this service.');
        },
        { isolationLevel: 'Serializable' }
      );
      return 'Saved to Squire’s knowledge for this service.';
    }
  }
  throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Unknown action.' });
}

// ---------------------------------------------------------------------------------------------------------
// Extended actions (opt-in). Each case calls the same domain command, with the same capability checks, as the
// matching control in the application, under the confirming person's session. Changes that commit in the
// database join the receipt in one serializable transaction after the sealed facts are re-read; changes that
// notify people or call another system (escalation, Jira, status page routes) re-check the facts in a
// serializable transaction first and then record the outcome, so a lost response is reported as unknown and
// never repeated.
// ---------------------------------------------------------------------------------------------------------

const serializable = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(work, { isolationLevel: 'Serializable' });

async function sessionUser(actor: AuthorizationActor) {
  const user = await getCurrentUser();
  if (user.id !== actor.id) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  return user;
}

const rejected = (userMessage: string) => new AppError({ code: 'VALIDATION_FAILED', userMessage });

/** Calls one of the application's own JSON route handlers in-process, exactly as its page does. */
async function callAppRoute(
  handler: (request: import('next/server').NextRequest) => Promise<Response>,
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { NextRequest } = await import('next/server');
  const response = await handler(
    new NextRequest(new URL(path, 'http://opsknight.internal'), {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.ok && payload) return payload;
  const message = typeof payload?.error === 'string' ? payload.error.slice(0, 300) : '';
  // A 4xx is the application refusing the change; anything else leaves the outcome unknown.
  if (response.status >= 400 && response.status < 500)
    throw rejected(message || 'The change was refused.');
  throw new Error(`Route returned ${response.status}`);
}

async function runExtended(
  actor: AuthorizationActor,
  proposal: OpenedProposal,
  input: Record<string, unknown>,
  incidentId: string,
  complete: Complete
): Promise<{ message: string; followUp?: FollowUp }> {
  const action = proposal.action as ExtendedSquireActionName;
  const recheck = (tx: Prisma.TransactionClient) =>
    checkExtendedPreconditions(tx, actor, action, input, incidentId, proposal.preconditions?.extra);
  const finish = async (message: string, followUp?: FollowUp) => {
    await serializable(tx => complete(tx, message, followUp));
    return { message, ...(followUp ? { followUp } : {}) };
  };

  switch (action) {
    case 'escalate_incident': {
      const user = await sessionUser(actor);
      await serializable(recheck);
      const { requestIncidentEscalation } = await import('@/lib/escalation/authorization');
      // The engine's own manual-escalation receipt makes a retry of this proposal page nobody twice.
      const outcome = await requestIncidentEscalation({
        incidentId,
        actor: { userId: actor.id, name: user.name },
        source: 'WEB',
        idempotency: { key: `squire:${proposal.id}`, principalId: actor.id },
      });
      if (!outcome.requested)
        throw rejected('Only an open incident can be escalated. Review the incident first.');
      const execution = outcome.execution;
      return finish(
        execution.escalated
          ? `Escalated: paged ${execution.targetName ? `“${execution.targetName.slice(0, 80)}”` : 'the next level'}.`
          : `Escalation requested; nobody new was paged (${(execution.reason ?? execution.outcome).slice(0, 160)}).`
      );
    }
    case 'change_urgency': {
      const { urgency } = input as SquireActionInput<'change_urgency'>;
      const responder = await assertResponderOrAbove();
      if (responder.id !== actor.id) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
      const { applyIncidentUrgencyChange } = await import('@/lib/incidents/urgency-command');
      const message = `Urgency changed to ${urgency}.`;
      await serializable(async tx => {
        await recheck(tx);
        await applyIncidentUrgencyChange(tx, { incidentId, urgency });
        await complete(tx, message);
      });
      return { message };
    }
    case 'snooze_incident': {
      const { minutes, reason } = input as SquireActionInput<'snooze_incident'>;
      const responder = await assertResponderOrAbove();
      if (responder.id !== actor.id) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
      const { applyIncidentLifecycleCommand } = await import('@/lib/incidents/lifecycle');
      // The duration is measured from confirmation, not from when the card was offered.
      const snoozedUntil = new Date(Date.now() + minutes * 60_000);
      const message = `Incident snoozed until ${snoozedUntil.toISOString().slice(11, 16)} UTC.`;
      await serializable(async tx => {
        await recheck(tx);
        await applyIncidentLifecycleCommand(tx, {
          incidentId,
          command: 'SNOOZE',
          source: 'WEB',
          actor: { id: responder.id, name: responder.name ?? undefined },
          snoozedUntil,
          snoozeReason: reason?.trim() || null,
          eventMessage: `Incident snoozed until ${snoozedUntil.toISOString()}${reason?.trim() ? ` (Reason: ${reason.trim()})` : ''} by ${responder.name ?? 'a responder'}`,
        });
        await complete(tx, message);
      });
      return { message };
    }
    case 'unlink_related_incident': {
      const { note } = input as SquireActionInput<'unlink_related_incident'>;
      const message = 'Related link removed.';
      await serializable(async tx => {
        const facts = await recheck(tx);
        await decideRelationship(
          actor,
          {
            relationshipId: String(facts.relationshipId),
            decision: 'REVERTED',
            ...(note ? { note } : {}),
          },
          tx
        );
        await complete(tx, message);
      });
      return { message };
    }
    case 'add_responder': {
      const { userId, role } = input as SquireActionInput<'add_responder'>;
      const user = await sessionUser(actor);
      // Same rule as the incident page's watcher control.
      const canManage = hasCapability(user.role as AppRole, CAPABILITIES.OPERATIONS_MANAGE);
      if (!canManage) {
        await assertCanViewIncident(incidentId);
        if (userId !== user.id || role !== 'FOLLOWER')
          throw new AppError({
            code: 'AUTHORIZATION_DENIED',
            userMessage: 'You may only subscribe yourself as a follower.',
          });
      }
      const { setIncidentWatcher } = await import('@/lib/incidents/watchers');
      const message = `Watcher added as ${role.toLowerCase()}.`;
      await serializable(async tx => {
        await recheck(tx);
        await setIncidentWatcher(
          { incidentId, userId, role },
          { id: user.id, role: user.role as AppRole },
          tx
        );
        await complete(tx, message);
      });
      return { message };
    }
    case 'create_jira_issue': {
      await sessionUser(actor);
      await serializable(recheck);
      const { createJiraIssueFromIncident } = await import('@/app/(app)/incidents/jira/actions');
      const created = await createJiraIssueFromIncident(incidentId);
      if (!created.success)
        throw rejected(created.error?.slice(0, 300) || 'Jira did not create the issue.');
      return finish(
        created.key
          ? `Jira issue ${created.key.slice(0, 40)} created and linked.`
          : 'Jira issue created and linked.'
      );
    }
    case 'draft_status_update': {
      const { title, message: body, type } = input as SquireActionInput<'draft_status_update'>;
      await sessionUser(actor);
      const facts = await serializable(recheck);
      const statusPageId = String(facts.statusPageId);
      const route = await import('@/app/api/settings/status-page/announcements/route');
      // An inactive announcement is the status page's draft: it is never shown or sent to subscribers.
      const created = await callAppRoute(
        route.POST,
        'POST',
        '/api/settings/status-page/announcements',
        {
          statusPageId,
          title,
          message: body,
          type,
          startDate: new Date().toISOString(),
          isActive: false,
          notifySubscribers: false,
          notificationTiming: 'NONE',
          publishOption: 'NOW',
        }
      );
      const announcementId = (created.data as { announcement?: { id?: unknown } } | undefined)
        ?.announcement?.id;
      if (typeof announcementId !== 'string') throw new Error('Draft id missing from response');
      // Publishing is its own sealed proposal and needs a second, separate confirmation.
      const publish = await buildProposal(
        actor,
        'publish_status_update',
        { incidentId, statusPageId, announcementId },
        new Date(),
        { followUp: true }
      ).catch(() => null);
      return finish(
        publish
          ? 'Draft saved on the status page. Review it below and confirm to publish.'
          : 'Draft saved on the status page. Publish it from the status page settings.',
        publish ?? undefined
      );
    }
    case 'publish_status_update': {
      const { statusPageId, announcementId } = input as SquireActionInput<'publish_status_update'>;
      await sessionUser(actor);
      const facts = await serializable(recheck);
      if (facts.isActive !== false) throw rejected('That status update is already published.');
      const route = await import('@/app/api/settings/status-page/announcements/route');
      await callAppRoute(route.PATCH, 'PATCH', '/api/settings/status-page/announcements', {
        statusPageId,
        id: announcementId,
        isActive: true,
        publishOption: 'NOW',
        notificationTiming: 'NONE',
      });
      return finish('Status update published.');
    }
    case 'run_runbook': {
      const user = await assertCapability(CAPABILITIES.RUNBOOK_EXECUTE);
      if (user.id !== actor.id) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
      await assertCanViewIncident(incidentId);
      const { previewRunbookExecution, startRunbookExecution } =
        await import('@/lib/runbooks/orchestrator');
      const { resolveV2RunbookExecution } = await import('@/lib/api-v2/runbook-execution');
      const message = 'Runbook started. Follow it on the incident’s Runbooks tab.';
      await serializable(async tx => {
        const facts = await recheck(tx);
        // The same path MCP uses (runbook_prepare_execution then runbook_execute_approved): resolve the
        // bound request, preview it, then start it with the preview's digest and authorization. The person's
        // confirm stands in for the review, and every runbook approval step still applies.
        const request = await resolveV2RunbookExecution(
          tx,
          { id: String((input as SquireActionInput<'run_runbook'>).runbookId) },
          { incidentId, bindingId: String(facts.bindingId), parameters: {} },
          actor
        );
        if (
          request.bindingId !== facts.bindingId ||
          request.runbookVersionId !== facts.versionId ||
          request.serviceId !== facts.serviceId
        )
          throw new AppError({
            code: 'PRECONDITION_FAILED',
            userMessage:
              'The runbook binding changed after this suggestion was prepared. Ask for a fresh suggestion.',
          });
        const preview = await previewRunbookExecution(request, tx);
        if (!preview.authorizationToken) throw rejected('This runbook cannot start right now.');
        await startRunbookExecution(
          {
            ...request,
            expectedPlanDigest: preview.digest,
            previewAuthorizationToken: preview.authorizationToken,
          },
          tx
        );
        await complete(tx, message);
      });
      return { message };
    }
  }
  throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Unknown action.' });
}

/** Read inside the same serializable transaction as the native mutation and outcome. */
async function checkPreconditions(
  tx: Prisma.TransactionClient,
  proposal: OpenedProposal,
  incidentId: string
) {
  const expected = proposal.preconditions;
  if (!expected) return;
  const current = await tx.incident.findUnique({
    where: { id: incidentId },
    select: {
      status: true,
      escalationGeneration: true,
      assigneeId: true,
      teamId: true,
      updatedAt: true,
    },
  });
  const conflict = () =>
    new AppError({
      code: 'PRECONDITION_FAILED',
      userMessage:
        'The incident changed after this suggestion was prepared. Review it and ask for a fresh suggestion.',
    });
  if (!current) throw conflict();
  if (
    (proposal.action === 'acknowledge_incident' || proposal.action === 'resolve_incident') &&
    (current.status !== expected.incident.status ||
      current.escalationGeneration !== expected.incident.escalationGeneration)
  )
    throw conflict();
  if (
    proposal.action === 'reassign_incident' &&
    (current.assigneeId !== expected.incident.assigneeId ||
      current.teamId !== expected.incident.teamId ||
      current.updatedAt.toISOString() !== expected.incident.updatedAt)
  )
    throw conflict();
  if (proposal.action === 'link_related_incident') {
    const other = (proposal.input as SquireActionInput<'link_related_incident'>).otherIncidentId;
    const relationship = await tx.incidentRelationship.findFirst({
      where: {
        type: 'RELATED',
        OR: [
          { sourceIncidentId: incidentId, targetIncidentId: other },
          { sourceIncidentId: other, targetIncidentId: incidentId },
        ],
      },
      select: { id: true, updatedAt: true },
    });
    if (
      (relationship?.id ?? null) !== (expected.relationship?.id ?? null) ||
      (relationship?.updatedAt.toISOString() ?? null) !== (expected.relationship?.updatedAt ?? null)
    )
      throw conflict();
  }
}

// ---------------------------------------------------------------------------------------------------
// Chat confirmations (Slack and Microsoft Teams buttons).
//
// A button click carries no browser session, so the session-bound checks used by `run` cannot apply.
// The caller resolves the linked chat account to its OpsKnight user (`actor`), who must own the sealed
// proposal. That user is then authorized inside the same serializable transaction as the change, through
// the same incident authorization the ChatOps commands use. Domain commands, preconditions and the
// receipt are exactly those of `run`.
// ---------------------------------------------------------------------------------------------------

/** A confirmation that arrived from a linked chat account. */
export interface SquireConfirmChannel {
  provider: 'SLACK' | 'MICROSOFT_TEAMS';
  /** The person's OpsKnight display name, for the incident timeline. */
  actorName: string;
}

async function runFromChat<N extends WriteAction>(
  actor: AuthorizationActor,
  channel: SquireConfirmChannel,
  action: N,
  input: SquireActionInput<N>,
  proposalId: string,
  complete: (tx: Prisma.TransactionClient, message: string) => Promise<void>,
  preconditions: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<string> {
  const incidentId = (input as { incidentId: string }).incidentId;
  const lifecycleActor = { id: actor.id, name: channel.actorName };
  const idempotency = { key: `squire:${proposalId}`, principalId: actor.id };
  // Resolving and reassigning keep the same role floor as the application's own buttons.
  const requireOperator = () => {
    if (!hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE))
      throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  };
  const authorized =
    (requested: 'NOTE' | 'ACKNOWLEDGE' | 'MANAGE') => async (tx: Prisma.TransactionClient) => {
      await authorizeChatOpsIncidentInTransaction(tx, incidentId, actor.id, requested);
      await preconditions(tx);
    };
  switch (action) {
    case 'acknowledge_incident': {
      await transitionIncidentToStatusIdempotent(
        {
          incidentId,
          status: 'ACKNOWLEDGED',
          expectedStatus: 'OPEN',
          source: 'CHATOPS',
          actor: lifecycleActor,
        },
        idempotency,
        tx => complete(tx, 'Incident acknowledged.'),
        authorized('ACKNOWLEDGE')
      );
      return 'Incident acknowledged.';
    }
    case 'resolve_incident': {
      requireOperator();
      const { resolution } = input as SquireActionInput<'resolve_incident'>;
      await executeIdempotentIncidentLifecycleCommand(
        {
          incidentId,
          command: 'RESOLVE',
          source: 'CHATOPS',
          actor: lifecycleActor,
          resolutionNote: resolution.trim(),
        },
        idempotency,
        tx => complete(tx, 'Incident resolved.'),
        authorized('MANAGE')
      );
      return 'Incident resolved.';
    }
    case 'add_incident_note': {
      const { content } = input as SquireActionInput<'add_incident_note'>;
      await prisma.$transaction(
        async tx => {
          await authorized('NOTE')(tx);
          await addIncidentNoteDomainCommand({ incidentId, content, actor: lifecycleActor }, tx);
          await complete(tx, 'Note added.');
        },
        { isolationLevel: 'Serializable' }
      );
      return 'Note added.';
    }
    case 'reassign_incident': {
      requireOperator();
      const { assigneeId } = input as SquireActionInput<'reassign_incident'>;
      await prisma.$transaction(
        async tx => {
          await authorized('MANAGE')(tx);
          await assignIncidentDomainCommand({ incidentId, assigneeId, actor: lifecycleActor }, tx);
          await complete(tx, 'Incident reassigned.');
        },
        { isolationLevel: 'Serializable' }
      );
      return 'Incident reassigned.';
    }
    case 'link_related_incident': {
      const { otherIncidentId, note } = input as SquireActionInput<'link_related_incident'>;
      await prisma.$transaction(
        async tx => {
          await preconditions(tx);
          await linkIncidents(
            actor,
            { incidentId, otherIncidentId, ...(note ? { note } : {}) },
            tx
          );
          await complete(tx, 'Incidents marked as related.');
        },
        { isolationLevel: 'Serializable' }
      );
      return 'Incidents marked as related.';
    }
  }
  // An action added later without a chat path is confirmed in the application instead.
  throw new AppError({
    code: 'VALIDATION_FAILED',
    userMessage: 'Open OpsKnight to confirm this suggestion.',
  });
}
