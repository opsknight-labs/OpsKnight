import { createHash } from 'node:crypto';
import { redactSecrets } from '../ai/redact';

/**
 * Pure rules for Squire's knowledge memory and proactive notes: chunking, hashing and the bounded shapes the
 * lane stores. Nothing here reads the database, so the rules are unit-tested on their own.
 */

export const KNOWLEDGE_SOURCE_KINDS = [
  'POSTMORTEM',
  'RUNBOOK_STEP',
  'RESOLUTION_NOTE',
  'INCIDENT_NOTE',
  'SERVICE_FACT',
] as const;
export type KnowledgeSourceKindValue = (typeof KNOWLEDGE_SOURCE_KINDS)[number];

/** Kinds derived from a source by the lane (and rebuildable). A service fact only exists because a person confirmed it. */
export const DERIVED_KNOWLEDGE_KINDS = [
  'POSTMORTEM',
  'RUNBOOK_STEP',
  'RESOLUTION_NOTE',
  'INCIDENT_NOTE',
] as const satisfies readonly KnowledgeSourceKindValue[];
export type DerivedKnowledgeKind = (typeof DERIVED_KNOWLEDGE_KINDS)[number];

/** Kinds tied to an incident: they follow the fingerprint retention and the incident's visibility. */
export const INCIDENT_KNOWLEDGE_KINDS = [
  'POSTMORTEM',
  'RESOLUTION_NOTE',
  'INCIDENT_NOTE',
] as const satisfies readonly KnowledgeSourceKindValue[];

/**
 * Kinds that carry text people wrote about an incident (and so may name people): offered to the model only
 * when the turn may carry Personal data. Runbook steps and service facts are operational text.
 */
export const PERSONAL_KNOWLEDGE_KINDS: ReadonlySet<KnowledgeSourceKindValue> = new Set(
  INCIDENT_KNOWLEDGE_KINDS
);

export const KNOWLEDGE_LIMITS = {
  /** Characters per stored chunk. */
  chunkChars: 800,
  /** Chunks per source; longer sources keep their beginning, where summaries and root causes are written. */
  maxChunksPerSource: 6,
  titleChars: 200,
  /** Rows per source kind per sync pass. */
  syncBatch: 100,
  /** Rows embedded per provider call. */
  embedBatch: 32,
  /** A source must be this old before the keyset passes it, so a commit that lands late is never skipped. */
  settleMs: 30_000,
  /** Lexical candidates fetched before visibility filtering and the optional semantic re-rank. */
  candidateLimit: 60,
  /** Results returned to the model. */
  resultLimit: 8,
  /** Characters of one result shown to the model. */
  resultChars: 600,
  /** How often the lane runs a sync pass while caught up. */
  syncIntervalMs: 5 * 60_000,
  factChars: 500,
  maxFactsPerService: 50,
} as const;

export const PROACTIVE_KINDS = ['BRIEFING', 'STAKEHOLDER_NUDGE', 'POSTMORTEM_DRAFT'] as const;
export type ProactiveKind = (typeof PROACTIVE_KINDS)[number];

export const PROACTIVE_LIMITS = {
  /** How often the lane looks for incidents that need proactive work. */
  scanIntervalMs: 60_000,
  /** Briefings are for incidents opened recently; older incidents are never briefed after the fact. */
  briefingWindowMs: 6 * 3_600_000,
  /** A briefing waits this long for the first analysis before it is written without it. */
  analysisGraceMs: 5 * 60_000,
  /** Postmortem drafts are written for incidents resolved within this window. */
  draftWindowMs: 24 * 3_600_000,
  /** Incidents considered per kind per scan. */
  scanBatch: 50,
  /** Services with any proactive switch on, read per scan. */
  maxPolicies: 500,
  minNudgeMinutes: 5,
  maxNudgeMinutes: 24 * 60,
  maxListItems: 5,
} as const;

/** Background identity for proactive AI calls: never a person, so it never spends anyone's personal share. */
export const PROACTIVE_AI_ACTOR = 'squire:proactive';

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Identity of a chunk's content; an unchanged source is never rewritten or re-embedded. */
export function knowledgeContentHash(title: string, text: string): string {
  return sha256Hex(`${title}\u0000${text}`).slice(0, 40);
}

const collapse = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

/** Credentials never enter the index: every stored string is redacted first, then bounded. */
export function cleanKnowledgeText(text: string | null | undefined, max = 20_000): string {
  return collapse(redactSecrets((text ?? '').slice(0, max)));
}

/**
 * Splits text into bounded chunks at paragraph, then sentence, then word boundaries. Deterministic, so the
 * same source always yields the same chunks (and hashes).
 */
export function chunkKnowledgeText(
  text: string,
  options: { chunkChars?: number; maxChunks?: number } = {}
): string[] {
  const size = options.chunkChars ?? KNOWLEDGE_LIMITS.chunkChars;
  const maxChunks = options.maxChunks ?? KNOWLEDGE_LIMITS.maxChunksPerSource;
  const clean = collapse(text);
  if (!clean) return [];
  const pieces = clean
    .split(/\n{2,}/)
    .flatMap(paragraph =>
      paragraph.length <= size
        ? [paragraph]
        : (paragraph.match(/[^.!?\n]+[.!?]*\s*/g) ?? [paragraph])
    )
    .flatMap(sentence => {
      const value = sentence.trim();
      if (value.length <= size) return value ? [value] : [];
      const words: string[] = [];
      let current = '';
      for (const word of value.split(/\s+/)) {
        if (word.length > size) {
          if (current) words.push(current);
          for (let start = 0; start < word.length; start += size)
            words.push(word.slice(start, start + size));
          current = '';
        } else if ((current ? current.length + 1 : 0) + word.length > size) {
          words.push(current);
          current = word;
        } else current = current ? `${current} ${word}` : word;
      }
      if (current) words.push(current);
      return words;
    });
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (!current) current = piece;
    else if (current.length + 1 + piece.length <= size) current = `${current}\n${piece}`;
    else {
      chunks.push(current);
      if (chunks.length >= maxChunks) return chunks;
      current = piece;
    }
  }
  if (current && chunks.length < maxChunks) chunks.push(current);
  return chunks;
}

export interface KnowledgeChunkDraft {
  chunkIndex: number;
  title: string;
  text: string;
  contentHash: string;
}

/** Title plus body, as stored chunks with their content hashes. */
export function buildChunks(title: string, body: string): KnowledgeChunkDraft[] {
  const cleanTitle = cleanKnowledgeText(title, KNOWLEDGE_LIMITS.titleChars * 4).slice(
    0,
    KNOWLEDGE_LIMITS.titleChars
  );
  return chunkKnowledgeText(cleanKnowledgeText(body)).map((text, chunkIndex) => ({
    chunkIndex,
    title: cleanTitle,
    text,
    contentHash: knowledgeContentHash(cleanTitle, text),
  }));
}

/** The searchable text of a postmortem: the parts responders read for "how was this fixed". */
export function postmortemKnowledgeBody(postmortem: {
  summary?: string | null;
  rootCause?: string | null;
  resolution?: string | null;
  lessons?: string | null;
}): string {
  return [
    postmortem.summary ? `Summary: ${postmortem.summary}` : '',
    postmortem.rootCause ? `Root cause: ${postmortem.rootCause}` : '',
    postmortem.resolution ? `Resolution: ${postmortem.resolution}` : '',
    postmortem.lessons ? `Lessons: ${postmortem.lessons}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface RunbookStepSource {
  name: string;
  description?: string | null;
}

/**
 * One chunk per runbook step: its name and description only. Step configuration (commands, URLs, secret
 * references) is never indexed.
 */
export function runbookStepChunks(runbookName: string, steps: RunbookStepSource[]) {
  return steps
    .slice(0, 50)
    .map((step, index) => {
      const title = cleanKnowledgeText(`${runbookName}: step ${index + 1}`).slice(
        0,
        KNOWLEDGE_LIMITS.titleChars
      );
      const text = cleanKnowledgeText(
        [step.name, step.description ?? ''].filter(Boolean).join('. '),
        4_000
      ).slice(0, KNOWLEDGE_LIMITS.chunkChars);
      return { chunkIndex: index, title, text, contentHash: knowledgeContentHash(title, text) };
    })
    .filter(chunk => chunk.text.length > 0);
}

/** Extracts the step names and descriptions from a stored runbook definition; anything malformed is skipped. */
export function readRunbookSteps(definition: unknown): RunbookStepSource[] {
  if (!definition || typeof definition !== 'object') return [];
  const steps = (definition as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap(step => {
    if (!step || typeof step !== 'object') return [];
    const { name, description } = step as { name?: unknown; description?: unknown };
    return typeof name === 'string' && name.trim()
      ? [{ name, description: typeof description === 'string' ? description : null }]
      : [];
  });
}

/** Words of a free-text query as an OR'ed tsquery over the 'simple' configuration; null when nothing is searchable. */
export function knowledgeTsQuery(query: string): string | null {
  const terms = [
    ...new Set(
      (query.toLowerCase().match(/[\p{L}\p{N}]{2,40}/gu) ?? []).filter(term => !STOP.has(term))
    ),
  ].slice(0, 8);
  return terms.length ? terms.join(' | ') : null;
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'was',
  'are',
  'how',
  'what',
  'why',
  'when',
  'did',
  'does',
  'this',
  'that',
  'with',
  'from',
  'have',
  'has',
  'had',
  'is',
  'it',
  'of',
  'to',
  'in',
  'on',
  'a',
  'an',
  'we',
  'our',
  'you',
  'be',
  'or',
  'at',
  'by',
]);

/** Final score: the lexical rank, blended with cosine similarity only when a semantic re-rank ran. */
export function blendKnowledgeScore(lexical: number, semantic: number | null): number {
  const lex = Math.max(0, Math.min(1, lexical));
  if (semantic === null) return lex;
  return 0.4 * lex + 0.6 * Math.max(0, Math.min(1, semantic));
}

/** A learned fact must be a short, plain statement; anything credential-shaped is refused, not stored redacted. */
export function validateServiceFact(
  text: string
): { ok: true; fact: string } | { ok: false; reason: string } {
  const fact = collapse(text);
  if (fact.length < 10) return { ok: false, reason: 'A fact needs at least 10 characters.' };
  if (fact.length > KNOWLEDGE_LIMITS.factChars)
    return { ok: false, reason: `A fact may be at most ${KNOWLEDGE_LIMITS.factChars} characters.` };
  if (redactSecrets(fact) !== fact)
    return { ok: false, reason: 'A fact must not contain credentials or secrets.' };
  return { ok: true, fact };
}
