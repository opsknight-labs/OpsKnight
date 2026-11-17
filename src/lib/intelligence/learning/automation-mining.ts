/* eslint-disable security/detect-object-injection -- Keys are built from a closed field list in this file. */
import type { PRIORITIES } from '@/lib/automation/contract';
import { defaultSuggestionName, type SuggestedRule } from '@/lib/automation/suggested-rule';
import { wilsonLowerBound } from '../recommendations/wilson';

type Priority = (typeof PRIORITIES)[number];

/**
 * Suggested automation rules mined from history (plan J1.3). Pure: no clock, database or model.
 *
 * The question: when incidents with the same opening facts (alert severity, alert source) keep being
 * corrected by a person the same way, a rule doing that when the incident opens would have saved the
 * correction. Two corrections are mined:
 * - priority: a person changed the priority; the rule sets it.
 * - team: a person handed the incident to a team; the rule routes it through the escalation policy whose
 *   first step pages that team (`teamPolicies`, resolved by the loader). A team with no such policy, or
 *   more than one, is not suggested: automation has no team action and guessing a policy would mislead.
 *   This is also the only policy change that can be mined, as nothing lets a person change an incident's
 *   policy after creation.
 * An association "facts -> correction" is suggested when enough incidents support it (`support`, the
 * corrected ones) and the Wilson lower bound of corrected / all-with-those-facts clears `minConfidence`, the
 * same bound the runbook ranker uses so 3 of 3 never outranks 47 of 50. Input is bounded: at most
 * `maxGroups` groups are read, largest first.
 */
export const AUTOMATION_MINING = {
  minSupport: 5,
  minIncidents: 8,
  minConfidence: 0.5,
  maxSuggestions: 5,
  maxGroups: 1000,
} as const;

/** Incidents grouped by their opening facts and how a person corrected them, from the loader. */
export interface MiningGroup {
  severity: string | null;
  source: string | null;
  incidents: number;
  /** Corrections by final priority: incidents in the group a person changed to that priority. */
  correctedTo: Partial<Record<Priority, number>>;
  /** Hand-offs by final team id: incidents in the group a person assigned to that team. */
  teamTo?: Record<string, number>;
}

export interface MinedRuleSuggestion {
  /** Stable identity of the association, for the insight key. */
  key: string;
  rule: SuggestedRule;
  incidents: number;
  corrected: number;
  confidence: number;
  /** Set for a team hand-off suggestion: the team the routed policy pages first. */
  teamId?: string;
}

type Facts = { severity?: string; source?: string };
const FIELDS = ['severity', 'source'] as const;

function antecedents(group: MiningGroup): Facts[] {
  const out: Facts[] = [];
  if (group.severity) out.push({ severity: group.severity });
  if (group.source) out.push({ source: group.source });
  if (group.severity && group.source) out.push({ severity: group.severity, source: group.source });
  return out;
}

const factsKey = (facts: Facts) => FIELDS.map(field => `${field}=${facts[field] ?? ''}`).join('&');

/** `general` covers `specific` when every fact of `general` is also in `specific`. */
const covers = (general: Facts, specific: Facts) =>
  FIELDS.every(field => general[field] === undefined || general[field] === specific[field]);

/** A correction: `id` is the key suffix; the rule action is a priority or a policy. */
type Target = { id: string; priority?: Priority; policyId?: string; teamId?: string };
type Corrections = Map<string, { target: Target; count: number }>;

function addCorrection(corrections: Corrections, target: Target, count: number): void {
  const entry = corrections.get(target.id) ?? { target, count: 0 };
  entry.count += count;
  corrections.set(target.id, entry);
}

export function mineAutomationRules(
  groups: readonly MiningGroup[],
  options: {
    /** Signatures of rules that already exist (`ruleSignature`), so they are not suggested again. */
    existing?: ReadonlySet<string>;
    /** Team id -> the one policy whose first step pages that team; teams missing here are not suggested. */
    teamPolicies?: Readonly<Record<string, string>>;
    limits?: Partial<Record<keyof typeof AUTOMATION_MINING, number>>;
  } = {}
): MinedRuleSuggestion[] {
  const limits = { ...AUTOMATION_MINING, ...options.limits };
  const bounded = [...groups].sort((a, b) => b.incidents - a.incidents).slice(0, limits.maxGroups);
  const totals = new Map<string, { facts: Facts; incidents: number; corrections: Corrections }>();
  for (const group of bounded) {
    for (const facts of antecedents(group)) {
      const key = factsKey(facts);
      const entry = totals.get(key) ?? { facts, incidents: 0, corrections: new Map() };
      entry.incidents += group.incidents;
      for (const [priority, count] of Object.entries(group.correctedTo) as Array<
        [Priority, number]
      >)
        addCorrection(entry.corrections, { id: priority, priority }, count);
      for (const [teamId, count] of Object.entries(group.teamTo ?? {})) {
        const policyId = options.teamPolicies?.[teamId];
        if (policyId)
          addCorrection(entry.corrections, { id: `team:${teamId}`, policyId, teamId }, count);
      }
      totals.set(key, entry);
    }
  }

  const candidates: Array<MinedRuleSuggestion & { facts: Facts; target: string }> = [];
  for (const { facts, incidents, corrections } of totals.values()) {
    if (incidents < limits.minIncidents) continue;
    for (const { target, count: corrected } of corrections.values()) {
      if (corrected < limits.minSupport) continue;
      const confidence = wilsonLowerBound(corrected, incidents);
      if (confidence < limits.minConfidence) continue;
      candidates.push({
        key: `${factsKey(facts)}>${target.id}`,
        rule: suggestionRule(facts, target),
        incidents,
        corrected,
        confidence: Math.round(confidence * 100) / 100,
        ...(target.teamId ? { teamId: target.teamId } : {}),
        facts,
        target: target.id,
      });
    }
  }

  // The most general association wins: a narrower one making the same correction adds nothing.
  const kept = candidates.filter(
    candidate =>
      !candidates.some(
        other =>
          other !== candidate &&
          other.target === candidate.target &&
          covers(other.facts, candidate.facts) &&
          Object.keys(other.facts).length < Object.keys(candidate.facts).length
      )
  );
  // Existing rules are dropped last, so an existing general rule also silences its narrower variants.
  return kept
    .filter(candidate => !options.existing?.has(ruleSignature(candidate.rule)))
    .sort(
      (a, b) => b.confidence - a.confidence || b.corrected - a.corrected || (a.key < b.key ? -1 : 1)
    )
    .slice(0, limits.maxSuggestions)
    .map(({ facts: _facts, target: _target, ...suggestion }) => suggestion);
}

function suggestionRule(facts: Facts, target: Target): SuggestedRule {
  const conditions = FIELDS.flatMap(field =>
    facts[field] === undefined
      ? []
      : [{ fieldKey: field, operator: 'EQ' as const, value: facts[field] as string }]
  );
  const rule = target.priority
    ? { conditions, priority: target.priority }
    : { conditions, policyId: target.policyId };
  return { name: defaultSuggestionName(rule), ...rule };
}

/** What a rule does, ignoring its name and id, to recognise a suggestion that already exists. */
export function ruleSignature(rule: {
  conditions: ReadonlyArray<{ fieldKey: string; operator: string; value?: unknown }>;
  priority?: string;
  policyId?: string;
}): string {
  const conditions = rule.conditions
    .map(c => `${c.fieldKey}|${c.operator}|${String(c.value ?? '').toLowerCase()}`)
    .sort();
  const action = rule.priority ?? (rule.policyId ? `policy:${rule.policyId}` : '');
  return `${conditions.join('&')}>${action}`;
}
