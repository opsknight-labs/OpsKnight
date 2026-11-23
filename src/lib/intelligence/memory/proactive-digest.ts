import { z } from 'zod/v4';
import { PROACTIVE_LIMITS } from './contract';

/**
 * Live updates of an automatic investigation, as a "What changed" digest between two runs. Pure: the lane hands
 * it the previous and the new diagnosis (the engine's rendered markdown, whose shape is fixed by
 * renderDiagnosis) and the signals that triggered the re-run; the result is stored, bounded, on the note.
 */

const line = z.string().max(300);
const list = z.array(line).max(PROACTIVE_LIMITS.maxListItems);
const sourceRef = z.object({ kind: z.string().max(32), id: z.string().max(128) }).strict();

export const investigationDigestSchema = z
  .object({
    at: z.string().max(40),
    revision: z.number().int().min(2),
    /** What triggered the re-run: counts about this incident and its service only. */
    signals: z.array(line).max(6),
    /** The new leading hypothesis, when it changed. */
    leading: line.nullable(),
    added: list,
    up: list,
    down: list,
    ruledOut: list,
    dropped: list,
    nextChecks: list,
    newEvidence: z
      .array(
        z
          .object({
            kind: z.string().max(32),
            id: z.string().max(128),
            label: line,
            href: z.string().max(300),
          })
          .strict()
      )
      .max(PROACTIVE_LIMITS.maxListItems),
    /** Every source either run read: the digest quotes both, so a viewer must be able to open all of them. */
    sources: z.array(sourceRef).max(128),
  })
  .strict();
export type InvestigationDigest = z.infer<typeof investigationDigestSchema>;

export interface ParsedDiagnosis {
  hypotheses: Array<{ title: string; confidence: number }>;
  ruledOut: string[];
  nextChecks: string[];
}

const strip = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 300);
const key = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Reads the ranked hypotheses, ruled-out titles and next checks back out of a rendered investigation. */
export function parseDiagnosis(answer: string): ParsedDiagnosis {
  const parsed: ParsedDiagnosis = { hypotheses: [], ruledOut: [], nextChecks: [] };
  let section = '';
  for (const raw of answer.split('\n')) {
    const heading = /^###\s+(.+)$/.exec(raw.trim());
    if (heading) {
      section = heading[1].toLowerCase();
      continue;
    }
    if (section.startsWith('ranked')) {
      const match = /^\d+\.\s+\*\*(.+?)\*\*\s+—\s+confidence\s+(\d{1,3})%/.exec(raw.trim());
      if (match) parsed.hypotheses.push({ title: strip(match[1]), confidence: Number(match[2]) });
    } else if (section.startsWith('ruled out')) {
      const match = /^-\s+~~(.+?)~~/.exec(raw.trim());
      if (match) parsed.ruledOut.push(strip(match[1]));
    } else if (section.startsWith('next checks')) {
      const match = /^-\s+(.+)$/.exec(raw.trim());
      if (match) parsed.nextChecks.push(strip(match[1]));
    }
  }
  return parsed;
}

/** A confidence move smaller than this (percentage points) is noise, not news. */
const MOVE_POINTS = 10;

/** What moved between two diagnoses. Titles are matched case- and punctuation-insensitively. */
export function diffDiagnoses(
  previous: ParsedDiagnosis,
  next: ParsedDiagnosis
): Pick<
  InvestigationDigest,
  'leading' | 'added' | 'up' | 'down' | 'ruledOut' | 'dropped' | 'nextChecks'
> {
  const max = PROACTIVE_LIMITS.maxListItems;
  const before = new Map(previous.hypotheses.map(h => [key(h.title), h]));
  const after = new Map(next.hypotheses.map(h => [key(h.title), h]));
  const wasRuledOut = new Set(previous.ruledOut.map(key));
  const nowRuledOut = new Set(next.ruledOut.map(key));
  const oldChecks = new Set(previous.nextChecks.map(key));
  const moved = (direction: 1 | -1) =>
    next.hypotheses.flatMap(h => {
      const old = before.get(key(h.title));
      return old && (h.confidence - old.confidence) * direction >= MOVE_POINTS
        ? [`${h.title} (${old.confidence}% → ${h.confidence}%)`]
        : [];
    });
  const leader = next.hypotheses[0];
  return {
    leading:
      leader && key(leader.title) !== key(previous.hypotheses[0]?.title ?? '')
        ? leader.title
        : null,
    added: next.hypotheses
      .filter(h => !before.has(key(h.title)))
      .map(h => `${h.title} (${h.confidence}%)`)
      .slice(0, max),
    up: moved(1).slice(0, max),
    down: moved(-1).slice(0, max),
    ruledOut: next.ruledOut.filter(title => !wasRuledOut.has(key(title))).slice(0, max),
    dropped: previous.hypotheses
      .filter(h => !after.has(key(h.title)) && !nowRuledOut.has(key(h.title)))
      .map(h => h.title)
      .slice(0, max),
    nextChecks: next.nextChecks.filter(check => !oldChecks.has(key(check))).slice(0, max),
  };
}

/** True when a re-run produced nothing a responder would want to be told about. */
export function digestIsEmpty(digest: InvestigationDigest): boolean {
  return (
    !digest.leading &&
    !digest.added.length &&
    !digest.up.length &&
    !digest.down.length &&
    !digest.ruledOut.length &&
    !digest.dropped.length &&
    !digest.nextChecks.length &&
    !digest.newEvidence.length
  );
}

/** The digest as the short "What changed" post for the incident channel. */
export function digestMarkdown(digest: InvestigationDigest): string {
  const block = (label: string, items: string[]) =>
    items.length ? [`**${label}**`, ...items.map(item => `- ${item}`)] : [];
  const lines = [
    ...(digest.signals.length ? [`_New since the last look: ${digest.signals.join('; ')}._`] : []),
    ...(digest.leading ? [`**Leading hypothesis is now:** ${digest.leading}`] : []),
    ...block('New hypotheses', digest.added),
    ...block('More likely', digest.up),
    ...block('Less likely', digest.down),
    ...block('Ruled out', digest.ruledOut),
    ...block('No longer supported', digest.dropped),
    // Evidence names other records; the channel gets a count, OpsKnight shows them to people who may read them.
    ...(digest.newEvidence.length
      ? [
          `_${digest.newEvidence.length} new piece${digest.newEvidence.length === 1 ? '' : 's'} of evidence; open the incident in OpsKnight to see them._`,
        ]
      : []),
    ...block('New next checks', digest.nextChecks),
  ];
  return lines.length > (digest.signals.length ? 1 : 0)
    ? lines.join('\n')
    : [...lines, 'No change to the conclusion.'].join('\n');
}

/**
 * An investigation as channel text. Everyone in a channel sees one message, so unlike the in-app note (which
 * re-checks every cited source per viewer) it carries only the verdict: the conclusion line, hypothesis titles
 * with their confidence, ruled-out titles, and a link back to the incident. Explanation prose (it can quote
 * logs and other records), the evidence lists and every other link are left out; OpsKnight shows the rest.
 */
export function channelSafeInvestigation(answer: string, incidentId: string): string {
  // Titles are model text: links become their bare label and nothing else markup-like survives.
  const title = (text: string) =>
    strip(text.replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1').replace(/[*_~`[\]<>|]/g, ''));
  const hypotheses: string[] = [];
  const ruledOut: string[] = [];
  let conclusion = '';
  for (const raw of answer.split('\n')) {
    const line = raw.trim();
    const hypothesis = /^\d+\.\s+\*\*(.+?)\*\*\s+—\s+confidence (\d{1,3})%(.*)$/.exec(line);
    // Confidence and support level only: the fixed wording renderDiagnosis writes, never free text.
    const level = hypothesis ? /^ \(([a-z, ]{1,60})\)/.exec(hypothesis[3])?.[1] : undefined;
    const ruled = /^-\s+~~(.+?)~~/.exec(line);
    if (hypothesis)
      hypotheses.push(
        `${hypotheses.length + 1}. **${title(hypothesis[1])}** — confidence ${hypothesis[2]}%${level ? ` (${level})` : ''}`
      );
    else if (ruled) ruledOut.push(`- ${title(ruled[1])}`);
    else if (!conclusion && /^\*\*Result: inconclusive\.\*\*/.test(line))
      conclusion = 'Result: inconclusive. The evidence read so far does not establish a cause.';
    else if (!conclusion && line.startsWith('I stopped before reaching a conclusion'))
      conclusion = 'The investigation stopped before reaching a conclusion.';
  }
  return [
    '**Squire investigation**',
    ...(conclusion ? [conclusion] : []),
    ...(hypotheses.length ? ['**Hypotheses**', ...hypotheses.slice(0, 5)] : []),
    ...(ruledOut.length ? ['**Ruled out**', ...ruledOut.slice(0, 5)] : []),
    `_Evidence and details: [open the incident in OpsKnight](/incidents/${encodeURIComponent(incidentId)}?insights=why)._`,
  ].join('\n');
}
