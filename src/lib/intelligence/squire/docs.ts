import 'server-only';
import type { AiToolDefinition } from '../ai/port';

/**
 * Product-docs search for "how do I…" questions, in both AI and basic mode. The index is built from the
 * docs of the release in development by scripts/build-squire-docs-index.mjs and loaded once, lazily. Docs
 * are public product text, so every signed-in person may read them; no tenant data is involved.
 *
 * Scoring is plain BM25 over each section (page title ×3, section heading ×2, text ×1) with light stemming:
 * enough for a few thousand short sections, with no dependency and no network.
 */

interface DocsIndex {
  source: string;
  pages: Array<{
    title: string;
    description: string;
    url: string;
    intro: string;
    sections: Array<{ heading: string; text: string }>;
  }>;
}

export interface DocsHit {
  title: string;
  heading: string | null;
  url: string;
  text: string;
}

interface Unit extends DocsHit {
  terms: Map<string, number>;
  length: number;
}

const STOP = new Set(
  'a an and are as at be by can do does for from get how i in is it make me my need of on or please set setup the this to up use want way what when where which who why with you your'.split(
    ' '
  )
);

const stem = (word: string) =>
  word.length > 4
    ? word.replace(/(?:ies|ing|ed|es|s)$/, match => (match === 'ies' ? 'y' : ''))
    : word;

export function docsTerms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter(word => word.length > 1 && !STOP.has(word))
    .map(stem);
}

let units: Promise<{ units: Unit[]; df: Map<string, number>; avg: number }> | null = null;

function weigh(target: Map<string, number>, text: string, weight: number) {
  for (const term of docsTerms(text)) target.set(term, (target.get(term) ?? 0) + weight);
}

async function load() {
  const index = (await import('./docs-index.json')).default as DocsIndex;
  const list: Unit[] = [];
  for (const page of index.pages) {
    const parts = [
      { heading: null, text: [page.description, page.intro].filter(Boolean).join(' ') },
      ...page.sections,
    ];
    for (const part of parts) {
      if (!part.text) continue;
      const terms = new Map<string, number>();
      weigh(terms, page.title, 3);
      if (part.heading) weigh(terms, part.heading, 2);
      weigh(terms, part.text, 1);
      let length = 0;
      for (const count of terms.values()) length += count;
      list.push({
        title: page.title,
        heading: part.heading,
        url: page.url,
        text: part.text,
        terms,
        length,
      });
    }
  }
  const df = new Map<string, number>();
  for (const unit of list)
    for (const term of unit.terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const avg = list.reduce((sum, unit) => sum + unit.length, 0) / Math.max(list.length, 1);
  return { units: list, df, avg };
}

/** The read tool for the model; the hits carry their public docs URL to link. */
export function buildDocsTool(): AiToolDefinition {
  return {
    name: 'search_product_docs',
    description:
      'Search the OpsKnight product documentation for how to use or set up a feature ("how do I add an override", "connect Slack"). Returns up to 3 sections with their docs URL. Answer from them and link the URL.',
    kind: 'READ',
    dataClass: 'PUBLIC',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 2, maxLength: 300 } },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async input => {
      const query = (input as { query?: unknown })?.query;
      if (typeof query !== 'string' || query.trim().length < 2) return { error: 'Invalid input' };
      const items = await searchProductDocs(query);
      return items.length ? { items } : { items, note: 'No documentation section matched.' };
    },
  };
}

/** The best sections for a question, at most one per page, best first. */
export async function searchProductDocs(query: string, limit = 3): Promise<DocsHit[]> {
  const terms = [...new Set(docsTerms(query.slice(0, 500)))];
  if (terms.length === 0) return [];
  units ??= load();
  const { units: list, df, avg } = await units;
  const k1 = 1.2;
  const b = 0.75;
  const scored: Array<{ unit: Unit; score: number }> = [];
  for (const unit of list) {
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const tf = unit.terms.get(term);
      if (!tf) continue;
      matched += 1;
      const idf = Math.log(1 + (list.length - df.get(term)! + 0.5) / (df.get(term)! + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * unit.length) / avg));
    }
    // A single shared word is noise for a multi-word question.
    if (matched > 0 && (terms.length === 1 || matched >= 2)) scored.push({ unit, score });
  }
  scored.sort((a, z) => z.score - a.score);
  const seen = new Set<string>();
  const hits: DocsHit[] = [];
  for (const { unit } of scored) {
    if (seen.has(unit.url)) continue;
    seen.add(unit.url);
    hits.push({ title: unit.title, heading: unit.heading, url: unit.url, text: unit.text });
    if (hits.length === limit) break;
  }
  return hits;
}
