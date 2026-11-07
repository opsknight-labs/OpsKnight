import 'server-only';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCanAddIncidentNote, assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { addIncidentNoteDomainCommand } from '@/lib/incidents/notes';
import { assignIncidentDomainCommand } from '@/lib/incidents/assignment';
import { resolveIncidentWithNote, updateIncidentStatus } from '@/lib/incidents/operator-lifecycle';
import { linkIncidents } from '../../correlation/commands';
import { readIncidentForActor } from '../deterministic';
import { SQUIRE_ACTION_INPUTS, SQUIRE_ACTION_KIND, type SquireActionInput } from './catalog';
import { openProposal, type OpenedProposal } from './proposals';
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
  token: string
): Promise<SquireActionResult> {
  if (actor.apiKey || actor.status !== 'ACTIVE') return failed('Sign in to confirm this action.');
  const proposal = await openProposal(token, actor.id);
  if (!proposal) return failed('This suggestion has expired. Ask again for a fresh one.');
  if (SQUIRE_ACTION_KIND[proposal.action] !== 'WRITE')
    return failed('Nothing to confirm for this suggestion.');
  const parsed = SQUIRE_ACTION_INPUTS[proposal.action].safeParse(proposal.input);
  if (!parsed.success) return failed('This suggestion is no longer valid.');
  if (proposal.action !== 'add_incident_note' && !proposal.preconditions)
    return failed('This suggestion needs a fresh review. Ask again for a new suggestion.');
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
        source: 'UI',
        details: { squireAction: proposal.action, proposalId: proposal.id, outcome },
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
    const complete = async (tx: Prisma.TransactionClient, message: string) => {
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
            })
          ),
        },
      });
      await audit('SUCCEEDED', tx);
    };
    const message = await run(
      actor,
      proposal.action as WriteAction,
      parsed.data as never,
      proposal.id,
      complete,
      tx => checkPreconditions(tx, proposal, incidentId)
    );
    try {
      revalidatePath(`/incidents/${incidentId}`);
    } catch {
      logger.warn('[Squire] Action succeeded; page refresh failed', { action: proposal.action });
    }
    return { ok: true, message, href: `/incidents/${encodeURIComponent(incidentId)}` };
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

type WriteAction = Exclude<keyof typeof SQUIRE_ACTION_INPUTS, 'open_runbook' | 'draft_postmortem'>;

async function run<N extends WriteAction>(
  actor: AuthorizationActor,
  action: N,
  input: SquireActionInput<N>,
  proposalId: string,
  complete: (tx: Prisma.TransactionClient, message: string) => Promise<void>,
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
