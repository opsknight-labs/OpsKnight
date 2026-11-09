/**
 * Plain-language wording for pre-paging noise decisions, shared by the incident timeline, the group view
 * and the incident list badges. Pure: no database, no server-only imports, safe in client components.
 */

export type NoiseControlName =
  | 'MAINTENANCE'
  | 'SUPPRESSION'
  | 'ORCHESTRATION'
  | 'CONTENT_DEDUP'
  | 'FLAPPING'
  | 'STORM'
  | 'HEARTBEAT';

export type NoiseActionName =
  'NONE' | 'SUPPRESS' | 'DOWNGRADE' | 'APPEND' | 'GROUP_CHILD' | 'HOLD' | 'DROP' | 'TRANSFORM';

export interface NoiseDecisionFacts {
  control: NoiseControlName | string;
  action: NoiseActionName | string;
  mode: 'OFF' | 'SHADOW' | 'ON' | string;
  applied: boolean;
  sourceName: string | null;
  reason: string;
  evidence?: unknown;
  reversedAt?: Date | string | null;
}

export interface NoiseDecisionExplanation {
  /** One line: what happened, naming the rule or window. */
  title: string;
  /** Bullet points answering "why". */
  why: string[];
  /** True when reversing would re-ingest the alert so it pages ("Reverse and page"). */
  reversalPages: boolean;
}

const PAGING_PREVENTED = new Set(['SUPPRESS', 'APPEND', 'GROUP_CHILD', 'HOLD', 'DROP']);

const quoted = (name: string | null, fallback: string) => (name ? `“${name}”` : fallback);

function headline(facts: NoiseDecisionFacts): string {
  const name = facts.sourceName;
  switch (facts.control) {
    case 'MAINTENANCE':
      return facts.action === 'DOWNGRADE'
        ? `Urgency lowered: in maintenance window ${quoted(name, '')}`.trim()
        : `In maintenance window ${quoted(name, '')}`.trim();
    case 'SUPPRESSION':
      return facts.action === 'DOWNGRADE'
        ? `Urgency lowered by rule ${quoted(name, '')}`.trim()
        : `Suppressed by rule ${quoted(name, '')}`.trim();
    case 'ORCHESTRATION':
      return `Orchestration rule ${quoted(name, '')}: ${actionVerb(facts.action)}`.replace(
        /\s+:/,
        ':'
      );
    case 'CONTENT_DEDUP':
      return 'Deduplicated into this incident';
    case 'FLAPPING':
      return 'Flapping alert suppressed';
    case 'STORM':
      return facts.action === 'HOLD'
        ? 'Held briefly: possible alert storm'
        : 'Grouped into parent incident';
    case 'HEARTBEAT':
      return `Heartbeat ${quoted(name, 'monitor')}: ${actionVerb(facts.action)}`;
    default:
      return `Noise control: ${actionVerb(facts.action)}`;
  }
}

function actionVerb(action: string): string {
  switch (action) {
    case 'SUPPRESS':
      return 'suppressed';
    case 'DOWNGRADE':
      return 'urgency lowered';
    case 'APPEND':
      return 'added to an open incident';
    case 'GROUP_CHILD':
      return 'grouped under a parent';
    case 'HOLD':
      return 'held';
    case 'DROP':
      return 'dropped';
    case 'TRANSFORM':
      return 'enriched';
    default:
      return action.toLowerCase().replace(/_/g, ' ');
  }
}

const EVIDENCE_LABELS: Record<string, string> = {
  recentIncidents: 'Incidents in the window',
  threshold: 'Threshold',
  windowSeconds: 'Window (s)',
  transitions: 'State changes',
  holdSeconds: 'Hold (s)',
  urgency: 'Paged at urgency',
  holdUntil: 'Held until',
  scope: 'Services in scope',
  topology: 'Topology-aware',
  similarity: 'Similarity',
};

/** Only short, known scalar evidence is shown; anything else stays in the settings audit view. */
function evidenceLines(evidence: unknown): string[] {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return [];
  const lines: string[] = [];
  const values = new Map(Object.entries(evidence as Record<string, unknown>));
  for (const [key, label] of Object.entries(EVIDENCE_LABELS)) {
    const value = values.get(key);
    if (typeof value === 'number' && Number.isFinite(value)) lines.push(`${label}: ${value}`);
    else if (typeof value === 'boolean') lines.push(`${label}: ${value ? 'yes' : 'no'}`);
    else if (typeof value === 'string' && value.length <= 40) lines.push(`${label}: ${value}`);
  }
  return lines.slice(0, 5);
}

export function explainNoiseDecision(facts: NoiseDecisionFacts): NoiseDecisionExplanation {
  const shadow = facts.mode === 'SHADOW' || !facts.applied;
  const base = headline(facts);
  const title = shadow ? `Shadow: would have been ${lowerFirst(base)}` : base;
  const why: string[] = [];
  if (facts.reason) why.push(facts.reason);
  if (shadow)
    why.push('Shadow mode: recorded for review only; nothing was changed and paging was normal.');
  why.push(...evidenceLines(facts.evidence));
  if (facts.reversedAt) why.push('An operator reversed this decision.');
  return {
    title,
    why,
    reversalPages: !shadow && PAGING_PREVENTED.has(facts.action),
  };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The short label used on incident list badges. */
export type NoiseBadgeKind = 'suppressed' | 'maintenance';

export function noiseBadgeKind(control: string): NoiseBadgeKind | null {
  if (control === 'MAINTENANCE') return 'maintenance';
  if (control === 'SUPPRESSION' || control === 'FLAPPING' || control === 'ORCHESTRATION')
    return 'suppressed';
  return null;
}

export function noiseBadgeLabel(control: string, sourceName: string | null): string {
  if (control === 'MAINTENANCE')
    return sourceName ? `In maintenance: ${sourceName}` : 'In maintenance';
  if (control === 'FLAPPING') return 'Suppressed: flapping';
  return sourceName ? `Suppressed by ${sourceName}` : 'Suppressed by rule';
}

/** The incident reference used across the app's lists: the last five id characters, upper-case. */
export const incidentRef = (id: string) => `#${id.slice(-5).toUpperCase()}`;
