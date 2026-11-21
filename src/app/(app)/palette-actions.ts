'use server';

import * as z from 'zod/v3';
import { checkRateLimit } from '@/lib/rate-limit';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { searchPaletteKnowledge } from '@/lib/intelligence/helpers/palette-search-loader';
import type { PaletteKnowledgeHit } from '@/lib/intelligence/helpers/palette-search';

const querySchema = z.string().min(1).max(300);

/**
 * Knowledge-index results for the command palette. A helper, never a gate: a signed-out or denied reader,
 * a switched-off feature, a rate-limited burst or a slow index all answer "nothing found".
 */
export async function searchPaletteKnowledgeAction(query: unknown): Promise<PaletteKnowledgeHit[]> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return [];
  try {
    const actor = await getCurrentAuthorizationActor();
    const rate = await checkRateLimit(`palette:knowledge:user:${actor.id}`, 20, 60_000);
    if (!rate.allowed) return [];
    return await searchPaletteKnowledge(actor, parsed.data);
  } catch {
    return [];
  }
}
