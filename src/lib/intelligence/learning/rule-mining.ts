import type { CorrelationRule } from '../contract';
import { computeSignature } from '../correlation/rules';
import { simulateCorrelation, type ReplayIncident } from '../evaluation/simulate';

/**
 * Learns correlation rules from what people decided, without any opaque model. Every candidate is an
 * ordinary deterministic rule (the same kinds people write), scored against human judgements:
 * links people made or accepted are positives, suggestions people rejected or reverted are negatives.
 * A candidate is only proposed when it explains enough confirmed links, rarely contradicts a rejection,
 * and would not sweep large parts of recent history into groups. Proposals are never applied
 * automatically; a person publishes one as a new policy version.
 */

export interface MiningIncident {
  id: string;
  serviceId: string;
  urgency: string;
  createdAt: Date;
  template: string;
  labels: Readonly<Record<string, string>>;
}

export interface JudgedPair {
  a: MiningIncident;
  b: MiningIncident;
  linked: boolean;
}

export interface RuleSuggestion {
  rule: CorrelationRule;
  /** Confirmed links the rule reproduces. */
  support: number;
  /** Rejected suggestions the rule would make again. */
  conflicts: number;
  /** support / (support + conflicts), on human-judged pairs only. */
  precision: number;
  /** Share of all confirmed same-service links the rule reproduces. */
  coverage: number;
  /** Replay over recent incidents: how much the rule would group on its own. */
  replay: { incidentsEvaluated: number; groups: number; groupedIncidents: number; suggestedLinks: number };
}

export const MINING_LIMITS = {
  minSupport: 3,
  minPrecision: 0.8,
  /** Window must cover this share of confirmed gaps. */
  windowCoverage: 0.9,
  /** A rule grouping more than this share of recent incidents is too broad to be useful. */
  maxGroupedShare: 0.3,
  maxSuggestions: 5,
} as const;

/** Standard windows, smallest first: the narrowest one that explains the evidence is chosen. */
export const CANDIDATE_WINDOWS_SECONDS = [300, 900, 1800, 3600, 4 * 3600, 24 * 3600] as const;
const MAX_WINDOW_SECONDS = 24 * 3600;

type Candidate = Pick<CorrelationRule, 'kind' | 'keys'>;

const candidateKey = (candidate: Candidate) => `${candidate.kind}:${[...candidate.keys].sort().join(',')}`;

function sharedLabelKeys(a: MiningIncident, b: MiningIncident): string[] {
  const other = new Map(Object.entries(b.labels));
  return Object.entries(a.labels)
    .filter(([key, value]) => value.length > 0 && other.get(key) === value)
    .map(([key]) => key);
}

function ruleId(candidate: Candidate, taken: ReadonlySet<string>): string {
  const base =
    candidate.kind === 'CONTENT_TEMPLATE'
      ? 'learned-same-title'
      : `learned-${candidate.keys.join('-')}`
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/-$/, '')
          .slice(0, 56);
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return id;
}

function asRule(candidate: Candidate, windowSeconds: number, id: string): CorrelationRule {
  return {
    id,
    kind: candidate.kind,
    enabled: true,
    keys: [...candidate.keys],
    windowSeconds,
    maxWindowSeconds: Math.min(MAX_WINDOW_SECONDS, windowSeconds * 4),
    minScore: 0.8,
  };
}

const gapSeconds = (pair: JudgedPair) => Math.abs(pair.a.createdAt.getTime() - pair.b.createdAt.getTime()) / 1000;

function signaturesMatch(candidate: Candidate, pair: JudgedPair): boolean {
  if (pair.a.serviceId !== pair.b.serviceId) return false;
  const probe = asRule(candidate, MAX_WINDOW_SECONDS, 'probe');
  const left = computeSignature(probe, pair.a);
  return left !== null && left === computeSignature(probe, pair.b);
}

/** Smallest standard window covering enough confirmed gaps, or null if even a day is not enough. */
function chooseWindow(gaps: readonly number[]): number | null {
  if (gaps.length === 0) return null;
  for (const window of CANDIDATE_WINDOWS_SECONDS) {
    const covered = gaps.filter(gap => gap <= window).length;
    if (covered / gaps.length >= MINING_LIMITS.windowCoverage) return window;
  }
  return null;
}

export function mineRuleSuggestions(
  pairs: readonly JudgedPair[],
  recent: readonly ReplayIncident[],
  existingRules: readonly CorrelationRule[]
): RuleSuggestion[] {
  // Rules only ever group within one service, so only same-service links are evidence for them.
  const positives = pairs.filter(pair => pair.linked && pair.a.serviceId === pair.b.serviceId);
  const negatives = pairs.filter(pair => !pair.linked);
  if (positives.length < MINING_LIMITS.minSupport) return [];

  const existing = new Set(existingRules.filter(rule => rule.enabled).map(candidateKey));
  const candidates = new Map<string, Candidate>();
  const add = (candidate: Candidate) => {
    const key = candidateKey(candidate);
    if (!existing.has(key)) candidates.set(key, candidate);
  };
  add({ kind: 'CONTENT_TEMPLATE', keys: [] });
  for (const pair of positives) {
    for (const key of sharedLabelKeys(pair.a, pair.b)) add({ kind: 'LABEL_SET', keys: [key] });
  }

  const taken = new Set(existingRules.map(rule => rule.id));
  const suggestions: RuleSuggestion[] = [];
  for (const candidate of candidates.values()) {
    const matched = positives.filter(pair => signaturesMatch(candidate, pair));
    const windowSeconds = chooseWindow(matched.map(gapSeconds));
    if (windowSeconds === null) continue;
    const support = matched.filter(pair => gapSeconds(pair) <= windowSeconds).length;
    if (support < MINING_LIMITS.minSupport) continue;
    const conflicts = negatives.filter(pair => signaturesMatch(candidate, pair) && gapSeconds(pair) <= windowSeconds).length;
    const precision = support / (support + conflicts);
    if (precision < MINING_LIMITS.minPrecision) continue;

    const rule = asRule(candidate, windowSeconds, ruleId(candidate, taken));
    const replay = simulateCorrelation(recent, [rule]);
    const evaluated = Math.max(1, replay.incidentsEvaluated);
    if (replay.groupedIncidents / evaluated > MINING_LIMITS.maxGroupedShare) continue;

    taken.add(rule.id);
    suggestions.push({
      rule,
      support,
      conflicts,
      precision: Math.round(precision * 1000) / 1000,
      coverage: Math.round((support / positives.length) * 1000) / 1000,
      replay: {
        incidentsEvaluated: replay.incidentsEvaluated,
        groups: replay.groups,
        groupedIncidents: replay.groupedIncidents,
        suggestedLinks: replay.suggestedLinks,
      },
    });
  }

  return suggestions
    .sort(
      (a, b) =>
        b.support - a.support ||
        b.precision - a.precision ||
        a.replay.groupedIncidents - b.replay.groupedIncidents ||
        a.rule.id.localeCompare(b.rule.id)
    )
    .slice(0, MINING_LIMITS.maxSuggestions);
}
