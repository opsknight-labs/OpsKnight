/**
 * Pure, deterministic similarity scoring used to re-rank retrieved candidates. It is explainable by
 * construction: every score is a weighted sum of named components, and only those numeric components
 * are persisted — never text from the candidate incident, which the viewer may not be allowed to see.
 */

export interface SimilarityFingerprint {
  template: string;
  tokens: readonly string[];
  labels: Readonly<Record<string, string>>;
  serviceId: string;
  incidentCreatedAt: Date;
  resolvedAt: Date | null;
}

export type SimilarityComponents = {
  /** Overlap of content words (Jaccard). */
  tokens: number;
  /** Character-trigram similarity of the masked templates. */
  template: number;
  /** Overlap of canonical label key=value pairs. */
  labels: number;
  sameService: number;
  /** 1 for brand-new, decaying with a 30-day half-life. */
  recency: number;
  /** Resolved incidents carry a known outcome and are more useful as precedent. */
  resolved: number;
  /** Cosine similarity of the two titles' embeddings, present only when semantic search is on. */
  semantic?: number;
};

export interface SimilarityScore {
  score: number;
  components: SimilarityComponents;
  matchedTokenCount: number;
}

export const SIMILARITY_WEIGHTS = {
  content: 0.5,
  labels: 0.2,
  sameService: 0.15,
  recency: 0.05,
  resolved: 0.1,
} as const;

export const RECENCY_HALF_LIFE_DAYS = 30;
/** Below this, shared boilerplate (" on", "-<num>") is noise, not a match. */
export const MIN_CONTENT_SIMILARITY = 0.15;
/**
 * Embedding cosine below this is treated as no semantic signal. Unrelated short texts commonly score
 * 0.3-0.7 depending on the model, so only the top of the range counts, and it is rescaled to 0-1.
 */
export const SEMANTIC_FLOOR = 0.7;

/** The part of a raw embedding cosine that counts as content similarity (0 when absent). */
export function semanticContent(cosine: number | undefined): number {
  if (cosine === undefined || !Number.isFinite(cosine)) return 0;
  return Math.min(1, Math.max(0, (cosine - SEMANTIC_FLOOR) / (1 - SEMANTIC_FLOOR)));
}

function trigrams(text: string): Set<string> {
  const result = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const padded = `  ${word} `;
    for (let i = 0; i <= padded.length - 3; i += 1) result.add(padded.slice(i, i + 3));
  }
  return result;
}

function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): { value: number; shared: number } {
  if (a.size === 0 || b.size === 0) return { value: 0, shared: 0 };
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return { value: shared / (a.size + b.size - shared), shared };
}

/** Same definition as pg_trgm's similarity(): shared trigrams over the union. */
export function trigramSimilarity(a: string, b: string): number {
  return jaccard(trigrams(a), trigrams(b)).value;
}

function labelPairs(labels: Readonly<Record<string, string>>): Set<string> {
  return new Set(Object.entries(labels).map(([key, value]) => `${key}=${value}`));
}

export function recencyFactor(createdAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / 86_400_000);
  return 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function scoreSimilarity(
  query: SimilarityFingerprint,
  candidate: SimilarityFingerprint,
  now: Date = new Date(),
  semantic?: number
): SimilarityScore {
  const tokens = jaccard(new Set(query.tokens), new Set(candidate.tokens));
  const template = trigramSimilarity(query.template, candidate.template);
  const labels = jaccard(labelPairs(query.labels), labelPairs(candidate.labels)).value;
  const components: SimilarityComponents = {
    tokens: round(tokens.value),
    template: round(template),
    labels: round(labels),
    sameService: query.serviceId === candidate.serviceId ? 1 : 0,
    recency: round(recencyFactor(candidate.incidentCreatedAt, now)),
    resolved: candidate.resolvedAt ? 1 : 0,
    ...(semantic !== undefined && Number.isFinite(semantic) ? { semantic: round(semantic) } : {}),
  };
  // Content similarity must be present for any match: service, recency and outcome only break ties
  // between genuinely similar incidents and can never manufacture a match on their own. Meaning from
  // embeddings can raise content similarity (different words, same problem) but never lower it.
  const content = Math.max(components.tokens, components.template, semanticContent(components.semantic));
  if (content < MIN_CONTENT_SIMILARITY) return { score: 0, components, matchedTokenCount: tokens.shared };

  // When neither incident carries labels the label signal does not exist, so its weight is removed
  // and the rest renormalized. Otherwise a perfect duplicate would cap at 0.8 and scores from
  // label-less and labelled sources would not be comparable.
  const hasLabels = Object.keys(query.labels).length + Object.keys(candidate.labels).length > 0;
  const labelWeight = hasLabels ? SIMILARITY_WEIGHTS.labels : 0;
  const totalWeight = 1 - SIMILARITY_WEIGHTS.labels + labelWeight;
  const score =
    (SIMILARITY_WEIGHTS.content * content +
      labelWeight * components.labels +
      SIMILARITY_WEIGHTS.sameService * components.sameService +
      SIMILARITY_WEIGHTS.recency * components.recency +
      SIMILARITY_WEIGHTS.resolved * components.resolved) /
    totalWeight;
  return { score: round(Math.min(1, score)), components, matchedTokenCount: tokens.shared };
}
