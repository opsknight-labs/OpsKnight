'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { revokeFeedback, submitFeedback } from '@/lib/intelligence/feedback/service';

export type SimilarFeedbackState = { ok: boolean; message: string; verdict: 'HELPFUL' | 'NOT_HELPFUL' | null };

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
      await revokeFeedback(actor, { subjectType: 'FINDING', subjectId: String(form.get('findingId') ?? '') });
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
