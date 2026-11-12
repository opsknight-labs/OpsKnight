import 'server-only';
import prisma from '@/lib/prisma';

/**
 * How common each word is across incident templates, read from the statistics PostgreSQL already keeps for
 * the stored search vector (ANALYZE records the most common elements of a tsvector and their frequencies). It
 * costs one catalog read every few minutes and no extra table or write. Words absent from the statistics are
 * rare by definition.
 */
const CACHE_TTL_MS = 10 * 60_000;

let cached: { at: number; frequencies: Map<string, number> } | null = null;

export async function termFrequencies(now: number = Date.now()): Promise<Map<string, number>> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.frequencies;
  const frequencies = new Map<string, number>();
  try {
    const rows = await prisma.$queryRaw<Array<{ elems: string[] | null; freqs: number[] | null }>>`
      SELECT most_common_elems::text::text[] AS elems, most_common_elem_freqs AS freqs
      FROM pg_stats WHERE tablename = 'IncidentFingerprint' AND attname = 'searchVector'`;
    const elems = rows[0]?.elems ?? [];
    const freqs = rows[0]?.freqs ?? [];
    // The frequency array carries three extra summary values after the per-element ones.
    elems.forEach((elem, index) => {
      const frequency = freqs.at(index);
      if (typeof frequency === 'number') frequencies.set(elem, frequency);
    });
  } catch {
    // Statistics are an optimisation only; without them every word counts as rare.
  }
  cached = { at: now, frequencies };
  return frequencies;
}

export function resetTermFrequencyCacheForTests() {
  cached = null;
}

/** A word in more than this share of incidents says little about which incidents are alike. */
export const COMMON_TERM_FREQUENCY = 0.05;
export const MAX_QUERY_TERMS = 8;

/**
 * The words worth searching for: rarest first, very common ones dropped, at most MAX_QUERY_TERMS. When every
 * word is common the rarest few are kept so the search still runs.
 */
export function selectQueryTerms(
  tokens: readonly string[],
  frequencies: ReadonlyMap<string, number>
): string[] {
  const unique = [...new Set(tokens)];
  const ranked = unique
    .map((token, order) => ({ token, order, frequency: frequencies.get(token) ?? 0 }))
    .sort((a, b) => a.frequency - b.frequency || a.order - b.order);
  const distinctive = ranked.filter(term => term.frequency <= COMMON_TERM_FREQUENCY);
  return (distinctive.length >= 2 ? distinctive : ranked.slice(0, Math.max(2, distinctive.length)))
    .slice(0, MAX_QUERY_TERMS)
    .map(term => term.token);
}

/**
 * Words required together by the full-text source. Two rare words in conjunction keep the matched set small
 * enough to rank cheaply; OR-ing several "rare" words was measured at 100k history to match 50x more rows
 * and take 4x longer (902 ms vs 218 ms), so recall beyond the conjunction is left to the same-service and
 * trigram sources.
 */
export const MAX_FULLTEXT_TERMS = 2;

export interface FullTextQueryPlan {
  /** The rarest words (at most MAX_FULLTEXT_TERMS), all required; empty when there are no words. */
  terms: string[];
  /** False when every word is common: a text search would rank a large share of history. */
  distinctive: boolean;
}

/**
 * What the full-text source should ask for: the two rarest words, both required. When no word is below the
 * common-term floor the plan says so, and the caller skips the text search where trigram matching covers the
 * same ground.
 */
export function planFullTextQuery(
  tokens: readonly string[],
  frequencies: ReadonlyMap<string, number>
): FullTextQueryPlan {
  const ranked = selectQueryTerms(tokens, frequencies);
  const distinctive = ranked.some(token => (frequencies.get(token) ?? 0) <= COMMON_TERM_FREQUENCY);
  return { terms: ranked.slice(0, MAX_FULLTEXT_TERMS), distinctive };
}

/** The websearch_to_tsquery text for a plan: every word required. */
export function fullTextQueryText(plan: FullTextQueryPlan): string {
  return plan.terms.join(' ');
}

/** Inverse document frequency from the same statistics; unknown words are treated as rare. */
export function inverseDocumentFrequency(
  token: string,
  frequencies: ReadonlyMap<string, number>
): number {
  const frequency = frequencies.get(token);
  return Math.log(1 / Math.max(frequency ?? 0.001, 0.001));
}
