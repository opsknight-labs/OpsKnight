'use server';

import * as z from 'zod/v3';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import type { ActionItemSuggestion } from '@/lib/intelligence/postmortems/evidence-draft';
import { getPostmortemAssistForActor } from '@/lib/intelligence/postmortems/loaders';
import type { PostmortemRecurrence } from '@/lib/intelligence/postmortems/recurrence';
import {
  suggestForActionItemDraft,
  type ActionItemDraftSuggestions,
} from '@/lib/intelligence/helpers/action-item-suggest-loader';

export interface PostmortemAssistView {
  /** Incident start and resolution (ISO), for the timeline-gap check. */
  window: { start: string; end: string | null };
  recurrence: PostmortemRecurrence | null;
  suggestions: ActionItemSuggestion[];
}

/**
 * What the postmortem editor shows beside the form: recurrence, action-item suggestions and the incident
 * window for the quality checklist. Read-only and scoped to what the signed-in person may read; null while
 * postmortem intelligence is off, so the editor then renders exactly as before.
 */
export async function getPostmortemAssistAction(
  incidentId: string
): Promise<PostmortemAssistView | null> {
  if (typeof incidentId !== 'string' || !incidentId || incidentId.length > 64) return null;
  try {
    const assist = await getPostmortemAssistForActor(
      incidentId,
      await getCurrentAuthorizationActor()
    );
    if (!assist) return null;
    return {
      window: {
        start: assist.window.start.toISOString(),
        end: assist.window.end?.toISOString() ?? null,
      },
      recurrence: assist.recurrence,
      suggestions: assist.suggestions,
    };
  } catch (error) {
    logger.warn('[Intelligence] postmortem assist failed', {
      error: error instanceof Error ? error.name : 'error',
    });
    return null;
  }
}

const actionItemDraftSchema = z.object({
  incidentId: z.string().min(1).max(64),
  title: z.string().max(500),
});

/**
 * Suggestions for the action item being typed: open look-alikes, a likely owner and the service. A helper,
 * never a gate: a denied reader, a switched-off feature or an invalid draft answer null.
 */
export async function suggestForActionItemDraftAction(
  input: unknown
): Promise<ActionItemDraftSuggestions | null> {
  const draft = actionItemDraftSchema.safeParse(input);
  if (!draft.success) return null;
  try {
    return await suggestForActionItemDraft(await getCurrentAuthorizationActor(), draft.data);
  } catch {
    return null;
  }
}
