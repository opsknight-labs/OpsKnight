import 'server-only';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { searchKnowledgeForActor } from '../memory/search';
import { getIntelligenceSettings } from '../settings/service';
import {
  paletteKnowledgeHits,
  paletteKnowledgeQuery,
  PALETTE_KNOWLEDGE_LIMIT,
  type PaletteKnowledgeHit,
} from './palette-search';

/** Incidents, postmortems and runbooks; service facts already surface through the palette's name lookup. */
const KINDS = ['POSTMORTEM', 'RUNBOOK_STEP', 'RESOLUTION_NOTE', 'INCIDENT_NOTE'] as const;

/**
 * Knowledge-index hits for a palette query, as `actor` may see them. Uses the index's own bounded search
 * (full text, trigram, and an embedding re-rank only when one is configured) and its per-source visibility
 * check; returns nothing while the helpers or the index are off, or for queries the name lookup covers.
 */
export async function searchPaletteKnowledge(
  actor: AuthorizationActor,
  raw: string,
  signal?: AbortSignal
): Promise<PaletteKnowledgeHit[]> {
  const query = paletteKnowledgeQuery(raw);
  if (!query || actor.status !== 'ACTIVE') return [];
  const settings = await getIntelligenceSettings();
  if (!settings.enabled || !settings.opsHelpersEnabled) return [];
  const result = await searchKnowledgeForActor(actor, {
    query,
    kinds: KINDS,
    // The palette is the person's own view, so their own incident notes may show.
    personal: true,
    // Several passages can come from one source; ask for a few more than are shown.
    limit: PALETTE_KNOWLEDGE_LIMIT * 2,
    signal,
  });
  return paletteKnowledgeHits(result.items);
}
