'use server';

import * as z from 'zod/v3';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { suggestForIncidentDraft } from '@/lib/intelligence/helpers/create-suggest-loader';
import type { DraftSuggestions } from '@/lib/intelligence/helpers/create-suggest';

const draftSchema = z.object({
  title: z.string().max(255),
  description: z.string().max(10_000).optional(),
  serviceId: z.string().max(64).optional(),
  urgency: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
});

/**
 * Suggestions for the incident being typed. A helper, never a gate: a denied reader, a switched-off
 * feature, an invalid draft or a slow index all answer "nothing to suggest".
 */
export async function suggestForIncidentDraftAction(
  input: unknown
): Promise<DraftSuggestions | null> {
  const draft = draftSchema.safeParse(input);
  if (!draft.success) return null;
  try {
    return await suggestForIncidentDraft(await getCurrentAuthorizationActor(), draft.data);
  } catch {
    return null;
  }
}
