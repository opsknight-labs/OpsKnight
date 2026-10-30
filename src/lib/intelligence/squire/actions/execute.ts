import 'server-only';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
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
import { openProposal } from './proposals';

export type SquireActionResult =
  { ok: true; message: string; href: string } | { ok: false; message: string };

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
  const proposal = await openProposal(token, actor.id);
  if (!proposal) return failed('This suggestion has expired. Ask again for a fresh one.');
  if (SQUIRE_ACTION_KIND[proposal.action] !== 'WRITE')
    return failed('Nothing to confirm for this suggestion.');
  const parsed = SQUIRE_ACTION_INPUTS[proposal.action].safeParse(proposal.input);
  if (!parsed.success) return failed('This suggestion is no longer valid.');
  const incidentId = (parsed.data as { incidentId: string }).incidentId;
  if (!(await readIncidentForActor(actor, incidentId)))
    return failed('That incident is not available to you.');

  // Single use: the receipt is written before the change, so a double click or a replayed request is refused.
  try {
    await prisma.squireActionReceipt.create({
      data: { id: proposal.id, userId: actor.id, action: proposal.action, incidentId },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return failed('This has already been done.');
    }
    throw error;
  }

  const audit = (outcome: 'SUCCEEDED' | 'FAILED') =>
    logAudit({
      action: 'intelligence.squire.action',
      entityType: 'INCIDENT',
      entityId: incidentId,
      actorId: actor.id,
      source: 'UI',
      details: { squireAction: proposal.action, proposalId: proposal.id, outcome },
    }).catch(() => undefined);

  try {
    const message = await run(actor, proposal.action as WriteAction, parsed.data as never);
    await audit('SUCCEEDED');
    try {
      revalidatePath(`/incidents/${incidentId}`);
    } catch {
      logger.warn('[Squire] Action succeeded; page refresh failed', { action: proposal.action });
    }
    return { ok: true, message, href: `/incidents/${encodeURIComponent(incidentId)}` };
  } catch (error) {
    await audit('FAILED');
    // A domain command can commit before a later step fails. Keep the single-use receipt:
    // retrying an uncertain attempt must never repeat a mutation.
    if (error instanceof AppError) return failed(error.userMessage);
    logger.warn('[Squire] Confirmed action failed', {
      action: proposal.action,
      error: error instanceof Error ? error.name : 'error',
    });
    return failed(
      'The action could not be confirmed. Refresh the incident before requesting a new suggestion.'
    );
  }
}

type WriteAction = Exclude<keyof typeof SQUIRE_ACTION_INPUTS, 'open_runbook' | 'draft_postmortem'>;

async function run<N extends WriteAction>(
  actor: AuthorizationActor,
  action: N,
  input: SquireActionInput<N>
): Promise<string> {
  switch (action) {
    case 'acknowledge_incident': {
      const { incidentId } = input as SquireActionInput<'acknowledge_incident'>;
      await updateIncidentStatus(incidentId, 'ACKNOWLEDGED', 'OPEN', 'WEB');
      return 'Incident acknowledged.';
    }
    case 'resolve_incident': {
      const { incidentId, resolution } = input as SquireActionInput<'resolve_incident'>;
      await resolveIncidentWithNote(incidentId, resolution, 'WEB');
      return 'Incident resolved.';
    }
    case 'add_incident_note': {
      const { incidentId, content } = input as SquireActionInput<'add_incident_note'>;
      await assertCanAddIncidentNote(incidentId);
      const user = await getCurrentUser();
      await addIncidentNoteDomainCommand({
        incidentId,
        content,
        actor: { id: user.id, name: user.name },
      });
      return 'Note added.';
    }
    case 'reassign_incident': {
      const { incidentId, assigneeId } = input as SquireActionInput<'reassign_incident'>;
      const responder = await assertResponderOrAbove();
      await assignIncidentDomainCommand({
        incidentId,
        assigneeId,
        actor: { id: responder.id, name: responder.name },
      });
      return 'Incident reassigned.';
    }
    case 'link_related_incident': {
      const { incidentId, otherIncidentId, note } =
        input as SquireActionInput<'link_related_incident'>;
      await linkIncidents(actor, { incidentId, otherIncidentId, ...(note ? { note } : {}) });
      return 'Incidents marked as related.';
    }
  }
  throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Unknown action.' });
}
