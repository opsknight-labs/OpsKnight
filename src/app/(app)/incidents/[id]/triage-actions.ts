'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { decideTriageSuggestion } from '@/lib/intelligence/triage/accept';

export type TriageActionState = {
  ok: boolean;
  message: string;
  verdict: 'CORRECT' | 'INCORRECT' | null;
};

const APPLIED_MESSAGE = {
  urgency: 'Urgency updated.',
  assignment: 'Incident reassigned.',
  duplicate: 'Incidents marked as related.',
  noted: 'Noted. Thanks for confirming.',
  none: 'Recorded.',
} as const;

/** Accepts (applies through the normal incident commands) or dismisses one triage suggestion. */
export async function decideTriage(
  incidentId: string,
  previous: TriageActionState,
  form: FormData
): Promise<TriageActionState> {
  try {
    const actor = await getCurrentAuthorizationActor();
    const result = await decideTriageSuggestion(actor, {
      findingId: String(form.get('findingId') ?? ''),
      decision: String(form.get('decision') ?? ''),
    });
    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath('/incidents');
    return {
      ok: true,
      message: result.decision === 'ACCEPT' ? APPLIED_MESSAGE[result.applied] : 'Dismissed.',
      verdict: result.decision === 'ACCEPT' ? 'CORRECT' : 'INCORRECT',
    };
  } catch (error) {
    if (error instanceof AppError) {
      const message =
        error.code === 'RESOURCE_NOT_FOUND'
          ? 'That suggestion is no longer available.'
          : error.code === 'RATE_LIMIT_EXCEEDED'
            ? 'You have given a lot of feedback recently. Please try again later.'
            : error.userMessage;
      return { ok: false, message, verdict: previous.verdict };
    }
    logger.error('[Intelligence] Triage decision failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: 'Unable to save. Try again.', verdict: previous.verdict };
  }
}
