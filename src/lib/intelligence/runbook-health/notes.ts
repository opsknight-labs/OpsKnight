import type { InsightItem } from './types';

/**
 * Pure text logic for runbook suggestions: group similar resolution notes and pull the actions out of them.
 * Deterministic and dependency-free; no model is involved.
 */

export const RUNBOOK_SUGGESTION_LIMITS = {
  /** Token-set Jaccard similarity at which two notes describe the same fix. */
  similarity: 0.5,
  minSimilarNotes: 3,
  maxDraftSteps: 12,
  maxStepLength: 160,
} as const;

const STOP_WORDS = new Set(
  'a an and the to of on in for was were is it its by with after before then we i that this from at as be been had has have our my so which again now back up down out all'.split(
    ' '
  )
);

/** Light suffix stripping so "restarted", "restarting" and "restarts" compare equal. */
function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3)
      return word.slice(0, -suffix.length);
  }
  return word;
}

/** Content words of a note; numbers are masked so "scaled to 6" and "scaled to 8" compare equal. */
export function noteTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\d+/g, '#')
    .split(/[^a-z#]+/)
    .filter(word => word.length >= 2 && !STOP_WORDS.has(word))
    .map(stem);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** FNV-1a, enough for a compact stable key; not a security boundary. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface NoteCluster<T> {
  /** Stable for a given seed note, whatever order the other notes arrive in. */
  signature: string;
  members: T[];
}

/**
 * Greedy single pass: each note joins the first cluster whose seed it resembles, else starts one.
 * Notes of fewer than two content words ("done", "fixed") are not evidence and are dropped.
 * Cost is notes x clusters set comparisons; callers pass a bounded list.
 */
export function clusterNotes<T extends { text: string }>(
  notes: readonly T[],
  similarity: number = RUNBOOK_SUGGESTION_LIMITS.similarity
): NoteCluster<T>[] {
  const clusters: Array<NoteCluster<T> & { seed: Set<string> }> = [];
  for (const note of notes) {
    const tokens = new Set(noteTokens(note.text));
    if (tokens.size < 2) continue;
    const home = clusters.find(cluster => jaccard(cluster.seed, tokens) >= similarity);
    if (home) home.members.push(note);
    else
      clusters.push({
        seed: tokens,
        signature: shortHash([...tokens].sort().join(' ')),
        members: [note],
      });
  }
  return clusters.map(({ signature, members }) => ({ signature, members }));
}

const VERBS = new Set(
  `add adjust allow apply ask block bounce bring bump change check clean clear close confirm contact cordon
  decrease delete deploy disable downgrade drain enable escalate evict expand extend fail fix flush free
  increase inspect invalidate kill lower migrate monitor move notify open patch pause promote provision purge
  raise reboot rebuild reconnect recreate redeploy refresh reindex reissue reload remove renew replace replay
  requeue rerun reset resize restart restore resume resync retry revert roll rollback rotate run scale set
  silence start stop switch sync take terminate throttle toggle truncate tune turn unblock uncordon update
  upgrade vacuum verify wait`.split(/\s+/)
);

const IRREGULAR_PAST = new Map([
  ['ran', 'run'],
  ['reran', 'rerun'],
  ['rebuilt', 'rebuild'],
  ['brought', 'bring'],
  ['took', 'take'],
]);

const COMMAND =
  /^(?:kubectl|systemctl|docker|helm|aws|gcloud|az|psql|redis-cli|ssh|curl|journalctl)\b/;
const LEAD_IN =
  /^(?:i|we|then|and|also|just|finally|first|next|manually|had to|needed to|have to|need to|please)\b[\s,]*/i;

function stripLeadIns(text: string): string {
  let current = text;
  for (let next = current.replace(LEAD_IN, ''); next !== current; next = next.replace(LEAD_IN, ''))
    current = next;
  return current;
}

/** The base form when `word` is a known action verb in base or past tense, else null. */
function baseVerb(word: string): string | null {
  const lower = word.toLowerCase();
  if (VERBS.has(lower)) return lower;
  const irregular = IRREGULAR_PAST.get(lower);
  if (irregular) return irregular;
  if (!lower.endsWith('ed')) return null;
  const candidates = [
    lower.slice(0, -2),
    lower.slice(0, -1),
    lower.slice(0, -3),
    lower.endsWith('ied') ? `${lower.slice(0, -3)}y` : '',
  ];
  return candidates.find(candidate => VERBS.has(candidate)) ?? null;
}

/** "Restarted the api pods." -> "Restart the api pods"; null when the fragment is not an action. */
function toImperative(fragment: string): string | null {
  const text = stripLeadIns(
    fragment.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').replace(/^resolved:\s*/i, '')
  )
    .trim()
    .replace(/[\s.;:,!]+$/, '');
  if (!text) return null;
  if (COMMAND.test(text)) return `Run ${text}`;
  const [first, ...rest] = text.split(/\s+/);
  const verb = baseVerb(first);
  if (!verb || rest.length === 0) return null;
  return `${verb[0].toUpperCase()}${verb.slice(1)} ${rest.join(' ')}`;
}

/** Splits a note into action-sized fragments; a clause that does not start with a verb stays attached. */
function fragments(note: string): string[] {
  const out: string[] = [];
  const sentences = note
    .split(/\r?\n|;/)
    .flatMap(line => line.split(/(?<=[.!?])\s/))
    .flatMap(sentence => sentence.split(/\b(?:and then|then)\b/i));
  for (const sentence of sentences) {
    let current = '';
    let separator = '';
    for (const part of sentence.split(/(,|\band\b)/i)) {
      if (part === ',' || part.toLowerCase() === 'and') separator += part;
      else if (separator && toImperative(part)) {
        out.push(current);
        current = part;
        separator = '';
      } else {
        current += separator + part;
        separator = '';
      }
    }
    out.push(current);
  }
  return out;
}

export interface DraftStep {
  name: string;
  /** How many of the notes contain this action. */
  support: number;
}

/**
 * The actions responders described, in the order they first appear. The same action worded slightly
 * differently in several notes becomes one step with a higher support.
 */
export function extractImperativeSteps(
  notes: readonly string[],
  maxSteps: number = RUNBOOK_SUGGESTION_LIMITS.maxDraftSteps
): DraftStep[] {
  const steps = new Map<string, { name: string; notes: Set<number> }>();
  notes.forEach((note, noteIndex) => {
    for (const fragment of fragments(note)) {
      const name = toImperative(fragment)?.slice(0, RUNBOOK_SUGGESTION_LIMITS.maxStepLength);
      if (!name) continue;
      const signature = [...new Set(noteTokens(name))].sort().join(' ');
      if (!signature) continue;
      const existing = steps.get(signature);
      if (existing) existing.notes.add(noteIndex);
      else steps.set(signature, { name, notes: new Set([noteIndex]) });
    }
  });
  return [...steps.values()]
    .slice(0, maxSteps)
    .map(step => ({ name: step.name, support: step.notes.size }));
}

export interface ResolutionNote {
  incidentId: string;
  text: string;
}

/** Hand-written resolution notes of one recurring problem (one masked incident title) on one service. */
export interface ProblemNotes {
  templateHash: string;
  template: string;
  notes: readonly ResolutionNote[];
  /** Runbook runs against these incidents; any means a runbook already covers the problem. */
  runbookRuns: number;
}

export interface MissingRunbookEvidence extends Record<string, unknown> {
  templateHash: string;
  template: string;
  noteCount: number;
  incidentIds: string[];
  sampleNotes: string[];
  steps: DraftStep[];
  /** Runbooks bound to the service. They never ran on this problem, so they do not cover it. */
  boundRunbooks: number;
}

/**
 * A problem that responders fixed by hand the same way at least three times, with no runbook run against
 * it, is a runbook waiting to be written. One item per problem, built from its largest group of similar
 * notes; problems whose notes contain no recognisable action produce nothing.
 */
export function missingRunbookInsights(
  problems: readonly ProblemNotes[],
  context: { boundRunbooks: number }
): Array<InsightItem & { evidence: MissingRunbookEvidence }> {
  const items: Array<InsightItem & { evidence: MissingRunbookEvidence }> = [];
  for (const problem of problems) {
    if (problem.runbookRuns > 0) continue;
    let best: { incidentIds: string[]; texts: string[] } | null = null;
    for (const cluster of clusterNotes(problem.notes)) {
      const incidentIds = [...new Set(cluster.members.map(member => member.incidentId))];
      if (
        incidentIds.length >= RUNBOOK_SUGGESTION_LIMITS.minSimilarNotes &&
        incidentIds.length > (best?.incidentIds.length ?? 0)
      )
        best = { incidentIds, texts: cluster.members.map(member => member.text) };
    }
    if (!best) continue;
    const steps = extractImperativeSteps(best.texts);
    if (steps.length === 0) continue;
    items.push({
      key: problem.templateHash,
      kind: 'RUNBOOK_MISSING',
      severity: 'info',
      title: `${best.incidentIds.length} incidents like "${problem.template.slice(0, 120)}" were resolved by hand the same way`,
      evidence: {
        templateHash: problem.templateHash,
        template: problem.template,
        noteCount: best.incidentIds.length,
        incidentIds: best.incidentIds.slice(0, 5),
        sampleNotes: best.texts.slice(0, 3).map(text => text.replace(/\s+/g, ' ').slice(0, 200)),
        steps,
        boundRunbooks: context.boundRunbooks,
      },
    });
  }
  return items.sort(
    (a, b) => b.evidence.noteCount - a.evidence.noteCount || a.key.localeCompare(b.key)
  );
}

export interface RunbookDraft {
  name: string;
  /** Base for the slug; the caller makes it unique. */
  slug: string;
  description: string;
  definition: {
    steps: Array<{
      key: string;
      name: string;
      type: 'MANUAL';
      riskClass: 'READ_ONLY';
      description: string;
      config: Record<string, never>;
    }>;
  };
}

/**
 * A draft runbook for a missing-runbook suggestion: one manual step per extracted action, nothing that
 * can execute. It is only ever saved as a draft; a person edits and publishes it in the runbook editor.
 */
export function draftRunbookFromSuggestion(
  evidence: Pick<MissingRunbookEvidence, 'template' | 'noteCount' | 'sampleNotes' | 'steps'>,
  serviceName: string
): RunbookDraft {
  const name = (evidence.template.replace(/\s+/g, ' ').trim() || 'Suggested runbook').slice(0, 120);
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '') || 'suggested-runbook';
  return {
    name,
    slug,
    description: [
      `Drafted from ${evidence.noteCount} hand-written resolution notes on ${serviceName}. Review every step before publishing.`,
      ...evidence.sampleNotes.map(note => `- ${note}`),
    ]
      .join('\n')
      .slice(0, 5000),
    definition: {
      steps: evidence.steps.map((step, index) => ({
        key: `step_${index + 1}`,
        name: step.name,
        type: 'MANUAL' as const,
        riskClass: 'READ_ONLY' as const,
        description: `Mentioned in ${step.support} of ${evidence.noteCount} resolution notes.`,
        config: {},
      })),
    },
  };
}
