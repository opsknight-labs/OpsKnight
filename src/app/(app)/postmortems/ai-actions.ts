'use server';

import { logger } from '@/lib/logger';
import { assertResponderOrAbove, getCurrentAuthorizationActor } from '@/lib/rbac';
import { draftPostmortem } from '@/lib/intelligence/drafts/service';
import { DRAFT_FAILURE_MESSAGES, type PostmortemDraft } from '@/lib/intelligence/drafts/schemas';

export type AiPostmortemDraftResult = { ok: true; draft: PostmortemDraft } | { ok: false; message: string };

/**
 * Drafts postmortem text with AI for the editor. The same permission as the existing auto-draft is required,
 * plus read access to the incident. Nothing is saved here: the person reviews the text and saves it through
 * the normal postmortem flow.
 */
export async function draftPostmortemWithAiAction(incidentId: string): Promise<AiPostmortemDraftResult> {
  try {
    await assertResponderOrAbove();
  } catch {
    return { ok: false, message: DRAFT_FAILURE_MESSAGES.NOT_ALLOWED };
  }
  try {
    const actor = await getCurrentAuthorizationActor();
    const result = await draftPostmortem(actor, incidentId);
    return result.ok ? { ok: true, draft: result.value } : { ok: false, message: DRAFT_FAILURE_MESSAGES[result.reason] };
  } catch (error) {
    logger.warn('[Intelligence] AI postmortem draft failed', { error: error instanceof Error ? error.name : 'error' });
    return { ok: false, message: DRAFT_FAILURE_MESSAGES.UNAVAILABLE };
  }
}
