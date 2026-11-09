'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCanAddIncidentNote, assertCanViewIncident, assertCapability } from '@/lib/rbac';
import { reversePrePagingDecision } from '@/lib/intelligence/noise-controls/decisions';
import { incidentSummarySchema } from '@/lib/intelligence/drafts/schemas';
import { formatSummaryAsNote } from '@/lib/intelligence/incident-ux/summary-note';
import { addIncidentNoteDomainCommand } from '@/lib/incidents/notes';

export type IncidentNoiseActionState = {
  ok: boolean;
  message: string;
  /** Set after a reversal re-ingested the alert: the new incident that now pages. */
  pagedIncidentId?: string | null;
  done?: boolean;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function failure(error: unknown, fallback: string): IncidentNoiseActionState {
  if (error instanceof AppError) return { ok: false, message: error.userMessage };
  if (error instanceof Error && /unauthori[sz]ed|forbidden/i.test(error.message))
    return { ok: false, message: 'You do not have permission to do that.' };
  logger.error('[Intelligence] Incident noise action failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { ok: false, message: fallback };
}

/**
 * "Ungroup and page" / "Reverse" from the incident page: the noise-controls reversal, with the same
 * permission as the noise settings page (INTELLIGENCE_MANAGE) plus read access to this incident. Only a
 * decision recorded on this incident can be reversed from here.
 */
export async function reverseIncidentNoiseDecision(
  incidentId: string,
  _previous: IncidentNoiseActionState,
  form: FormData
): Promise<IncidentNoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    if (!ID.test(incidentId)) return { ok: false, message: 'Invalid incident.' };
    await assertCanViewIncident(incidentId);
    const decisionId = String(form.get('decisionId') ?? '');
    if (!ID.test(decisionId)) return { ok: false, message: 'Invalid decision.' };
    const owned = await prisma.prePagingDecision.findFirst({
      where: { id: decisionId, incidentId },
      select: { id: true },
    });
    if (!owned) return { ok: false, message: 'That decision is not on this incident.' };
    const result = await reversePrePagingDecision(decisionId, { actorId: user.id, source: 'UI' });
    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath('/incidents');
    if (result.outcome === 'reversed') {
      if (result.incidentId) revalidatePath(`/incidents/${result.incidentId}`);
      return {
        ok: true,
        done: true,
        pagedIncidentId: result.incidentId,
        message: result.incidentId
          ? 'Ungrouped. The alert was re-ingested as its own incident and pages normally.'
          : 'Reversed and recorded as a wrong decision.',
      };
    }
    return {
      ok: false,
      done: result.outcome === 'already_reversed',
      message:
        result.outcome === 'already_reversed'
          ? 'Already reversed.'
          : 'That decision no longer exists.',
    };
  } catch (error) {
    return failure(error, 'Unable to reverse. Refresh and try again.');
  }
}

const postSummarySchema = z
  .object({
    summary: incidentSummarySchema,
    model: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

/**
 * Posts the summary the responder is looking at as an incident note, through the same note command and
 * the same permission as the note composer (responders and admins who may add notes to this incident).
 */
export async function postSummaryAsNoteAction(
  incidentId: string,
  input: unknown
): Promise<IncidentNoiseActionState> {
  try {
    if (!ID.test(incidentId)) return { ok: false, message: 'Invalid incident.' };
    const user = await assertCanAddIncidentNote(incidentId);
    await assertCanViewIncident(incidentId);
    const parsed = postSummarySchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        message: 'The summary could not be posted. Regenerate it and try again.',
      };
    await addIncidentNoteDomainCommand({
      incidentId,
      content: formatSummaryAsNote(parsed.data.summary, {
        kind: 'ai',
        model: parsed.data.model ?? null,
      }),
      actor: { id: user.id, name: user.name ?? undefined },
    });
    revalidatePath(`/incidents/${incidentId}`);
    return { ok: true, done: true, message: 'Summary posted as a note.' };
  } catch (error) {
    return failure(error, 'Unable to post the note. Try again.');
  }
}
