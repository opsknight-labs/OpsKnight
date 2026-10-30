'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { revokeFeedback, submitFeedback } from '@/lib/intelligence/feedback/service';
import { decideRelationship, linkIncidents } from '@/lib/intelligence/correlation/commands';
import { summarizeIncident } from '@/lib/intelligence/drafts/service';
import { DRAFT_FAILURE_MESSAGES, type IncidentSummary } from '@/lib/intelligence/drafts/schemas';

export type SimilarFeedbackState = {
  ok: boolean;
  message: string;
  verdict: 'HELPFUL' | 'NOT_HELPFUL' | null;
};

/**
 * Rates one similar-incident suggestion. The verdict and reason are validated by the domain service,
 * which also checks the viewer can read the incident and the precedent it points at.
 */
export async function rateSimilarIncident(
  incidentId: string,
  _previous: SimilarFeedbackState,
  form: FormData
): Promise<SimilarFeedbackState> {
  const verdict = form.get('verdict');
  const previous = _previous.verdict;
  try {
    const actor = await getCurrentAuthorizationActor();
    if (verdict === 'REVOKE') {
      await revokeFeedback(actor, {
        subjectType: 'FINDING',
        subjectId: String(form.get('findingId') ?? ''),
      });
      revalidatePath(`/incidents/${incidentId}`);
      return { ok: true, message: 'Feedback removed.', verdict: null };
    }
    const reason = String(form.get('reasonCode') ?? '');
    await submitFeedback(actor, {
      subjectType: 'FINDING',
      subjectId: String(form.get('findingId') ?? ''),
      verdict,
      ...(verdict === 'NOT_HELPFUL' && reason ? { reasonCode: reason } : {}),
    });
    revalidatePath(`/incidents/${incidentId}`);
    return {
      ok: true,
      message: 'Thanks, your feedback helps improve suggestions.',
      verdict: verdict === 'HELPFUL' ? 'HELPFUL' : 'NOT_HELPFUL',
    };
  } catch (error) {
    if (error instanceof AppError) {
      const message =
        error.code === 'RATE_LIMIT_EXCEEDED'
          ? 'You have given a lot of feedback recently. Please try again later.'
          : error.code === 'RESOURCE_NOT_FOUND'
            ? 'That suggestion is no longer available.'
            : error.userMessage;
      return { ok: false, message, verdict: previous };
    }
    logger.error('[Intelligence] Similar-incident feedback failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: 'Unable to save feedback. Try again.', verdict: previous };
  }
}

export type RelatedDecisionState = {
  ok: boolean;
  message: string;
  decision: 'SUGGESTED' | 'ACCEPTED' | 'REJECTED' | 'REVERTED';
};

/** Accepts, rejects or undoes one suggested related-incident link on behalf of the signed-in user. */
export async function decideRelatedIncident(
  incidentId: string,
  previous: RelatedDecisionState,
  form: FormData
): Promise<RelatedDecisionState> {
  const decision = String(form.get('decision') ?? '');
  try {
    const actor = await getCurrentAuthorizationActor();
    const result = await decideRelationship(actor, {
      relationshipId: String(form.get('relationshipId') ?? ''),
      decision,
    });
    revalidatePath(`/incidents/${incidentId}`);
    return {
      ok: true,
      message:
        result.decision === 'ACCEPTED'
          ? 'Marked as related.'
          : result.decision === 'REJECTED'
            ? 'Marked as not related.'
            : 'Link removed.',
      decision: result.decision,
    };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        ok: false,
        message:
          error.code === 'RESOURCE_NOT_FOUND'
            ? 'That link is no longer available.'
            : error.userMessage,
        decision: previous.decision,
      };
    }
    logger.error('[Intelligence] Related-incident decision failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: 'Unable to save. Try again.', decision: previous.decision };
  }
}

export type IncidentSummaryState =
  | { status: 'idle' }
  | { status: 'ok'; summary: IncidentSummary; model: string; promptVersion: number }
  | { status: 'error'; message: string };

/** Generates a read-only summary for the person who asked. Nothing is stored. */
export async function summarizeIncidentAction(incidentId: string): Promise<IncidentSummaryState> {
  try {
    const actor = await getCurrentAuthorizationActor();
    const result = await summarizeIncident(actor, incidentId);
    return result.ok
      ? {
          status: 'ok',
          summary: result.value,
          model: result.model,
          promptVersion: result.promptVersion,
        }
      : { status: 'error', message: DRAFT_FAILURE_MESSAGES[result.reason] };
  } catch (error) {
    logger.warn('[Intelligence] Incident summary failed', {
      error: error instanceof Error ? error.name : 'error',
    });
    return { status: 'error', message: DRAFT_FAILURE_MESSAGES.UNAVAILABLE };
  }
}

/** Uses the same visibility and feedback permission checks as manual incident linking. */
export async function markIncidentRelated(
  incidentId: string,
  otherIncidentId: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const actor = await getCurrentAuthorizationActor();
    await linkIncidents(actor, { incidentId, otherIncidentId });
    revalidatePath(`/incidents/${incidentId}`);
    return { ok: true, message: 'Incidents marked as related.' };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AppError
          ? error.userMessage
          : 'Unable to link incidents. Refresh and try again.',
    };
  }
}
