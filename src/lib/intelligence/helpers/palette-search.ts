/**
 * Natural-language search in the command palette. Pure: decides when a palette query reads like a question
 * worth sending to the knowledge index, and folds index hits into one row per source.
 */
export interface PaletteKnowledgeHit {
  kind: 'incident' | 'postmortem' | 'runbook';
  href: string;
  title: string;
  /** Short excerpt of the best matching passage, already redacted and capped by the index. */
  snippet: string;
}

/** Index hits as `searchKnowledgeForActor` returns them, reduced to what the palette needs. */
export interface PaletteKnowledgeSource {
  title: string;
  text: string;
  source: { kind: string; href: string };
}

export const PALETTE_KNOWLEDGE_MIN_WORDS = 3;
export const PALETTE_KNOWLEDGE_LIMIT = 5;
const SNIPPET_CHARS = 140;

/**
 * The query to send, or null when the palette's own name lookup already covers it: fewer than three words
 * ("db", "checkout api") or an id-like token. Only questions and phrases go to the index.
 */
export function paletteKnowledgeQuery(raw: string): string | null {
  const query = raw.trim().replace(/\s+/g, ' ').slice(0, 200);
  const words = query.split(' ').filter(word => /\p{L}{2,}/u.test(word));
  return words.length >= PALETTE_KNOWLEDGE_MIN_WORDS ? query : null;
}

/** One row per incident, postmortem or runbook (best passage first), services left to the name lookup. */
export function paletteKnowledgeHits(
  items: readonly PaletteKnowledgeSource[]
): PaletteKnowledgeHit[] {
  const seen = new Set<string>();
  const hits: PaletteKnowledgeHit[] = [];
  for (const item of items) {
    const kind = item.source.kind;
    if (kind !== 'incident' && kind !== 'postmortem' && kind !== 'runbook') continue;
    if (seen.has(item.source.href)) continue;
    seen.add(item.source.href);
    const text = item.text.replace(/\s+/g, ' ').trim();
    hits.push({
      kind,
      href: item.source.href,
      title: item.title,
      snippet: text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS - 1)}…` : text,
    });
    if (hits.length === PALETTE_KNOWLEDGE_LIMIT) break;
  }
  return hits;
}
