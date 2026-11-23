'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';
import { logger } from '@/lib/logger';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';
import {
  feedbackEvalCase,
  getFeedbackForReview,
  setFeedbackReview,
} from '@/lib/intelligence/assistant/feedback';
import { buildProposal } from '@/lib/intelligence/squire/actions/proposals';
import type { SquireProposal } from '@/lib/intelligence/squire/actions/catalog';

const PAGE = '/settings/intelligence/ai/feedback';
const feedbackId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export type FeedbackActionResult =
  | { ok: true; message: string; proposal?: SquireProposal & { href?: string }; json?: string }
  | { ok: false; message: string };

const fail = (message: string): FeedbackActionResult => ({ ok: false, message });

/** Every action here is for intelligence administrators; the actor is resolved after the check. */
async function administrator() {
  await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
  return getCurrentAuthorizationActor();
}

async function guarded(
  label: string,
  run: () => Promise<FeedbackActionResult>
): Promise<FeedbackActionResult> {
  try {
    return await run();
  } catch (error) {
    logger.warn(`[Squire] Feedback ${label} failed`, {
      error: error instanceof Error ? error.name : 'error',
    });
    return fail(
      error instanceof AuthorizationError
        ? 'Only intelligence administrators can review Squire feedback.'
        : 'That did not work. Refresh and try again.'
    );
  }
}

/**
 * "Learn for this service": turns the feedback into a pending fact through Squire's existing knowledge path.
 * Nothing is saved yet; the reviewer gets the same confirmation card a chat proposal shows, and confirming it
 * re-checks the knowledge switch, the incident and the right to curate the service.
 */
const factInput = z.string().trim().min(10).max(500);

export async function learnFromFeedbackAction(
  id: string,
  fact: string
): Promise<FeedbackActionResult> {
  return guarded('learn', async () => {
    const actor = await administrator();
    if (!feedbackId.safeParse(id).success) return fail('Unknown feedback.');
    const parsedFact = factInput.safeParse(fact);
    if (!parsedFact.success) return fail('A fact must be 10 to 500 characters.');
    const row = await getFeedbackForReview(id);
    if (!row) return fail('That feedback no longer exists.');
    if (!row.incidentId)
      return fail(
        'Squire learns service facts from an incident, and this answer was not asked on one.'
      );
    const proposal = await buildProposal(actor, 'learn_service_fact', {
      incidentId: row.incidentId,
      fact: parsedFact.data,
    });
    if (!proposal)
      return fail(
        'No fact can be proposed: the knowledge index may be off, the fact must be 10 to 500 characters with no secrets, and you must be able to curate the incident’s service.'
      );
    // Stays NEW until the card is confirmed (markFeedbackLearnedAction); revalidating here would drop the
    // row, and the card with it, from the "New" list.
    return { ok: true, message: 'Review the fact below and confirm it to save it.', proposal };
  });
}

/** "Add to eval set": a JSON case for the basic or scripted evaluation suites. */
export async function feedbackEvalCaseAction(id: string): Promise<FeedbackActionResult> {
  return guarded('eval case', async () => {
    await administrator();
    if (!feedbackId.safeParse(id).success) return fail('Unknown feedback.');
    const row = await getFeedbackForReview(id);
    if (!row) return fail('That feedback no longer exists.');
    const json = JSON.stringify(await feedbackEvalCase(row), null, 2);
    // Marked LEARNED by the page once the case is on screen (markFeedbackLearnedAction).
    return {
      ok: true,
      message:
        row.mode === 'basic'
          ? 'Add this to tests/evals/squire/basic-cases.ts and fill in what the answer must contain.'
          : 'Add this to tests/evals/squire/model-cases.ts and script the model reply.',
      json,
    };
  });
}

const learnedOutcome = z.enum(['learn_candidate', 'eval_case']);

/**
 * Marks feedback LEARNED once its outcome happened: the fact card was confirmed or the eval case was shown.
 * No revalidation, so the card or the case stays on screen; the row leaves the "New" list on the next load.
 */
export async function markFeedbackLearnedAction(
  id: string,
  outcome: 'learn_candidate' | 'eval_case'
): Promise<FeedbackActionResult> {
  return guarded('mark learned', async () => {
    const actor = await administrator();
    const parsed = learnedOutcome.safeParse(outcome);
    if (!feedbackId.safeParse(id).success || !parsed.success) return fail('Unknown feedback.');
    if (!(await setFeedbackReview(actor, id, 'LEARNED', parsed.data)))
      return fail('That feedback no longer exists.');
    return { ok: true, message: 'Marked as learned.' };
  });
}

export async function dismissFeedbackAction(id: string): Promise<FeedbackActionResult> {
  return guarded('dismiss', async () => {
    const actor = await administrator();
    if (!feedbackId.safeParse(id).success) return fail('Unknown feedback.');
    if (!(await setFeedbackReview(actor, id, 'DISMISSED', 'dismissed')))
      return fail('That feedback no longer exists.');
    revalidatePath(PAGE);
    return { ok: true, message: 'Dismissed.' };
  });
}
