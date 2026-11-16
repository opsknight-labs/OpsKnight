/* eslint-disable security/detect-object-injection -- Keys are built from a closed field list in this file. */
import type { PRIORITIES } from '@/lib/automation/contract';
import { defaultSuggestionName, type SuggestedRule } from '@/lib/automation/suggested-rule';
import { wilsonLowerBound } from '../recommendations/wilson';

type Priority = (typeof PRIORITIES)[number];

/**
 * Suggested automation rules mined from history (plan J1.3). Pure: no clock, database or model.
 *
 * The question: when incidents with the same opening facts (alert severity, alert source) keep having their
 * priority changed by a person to the same value, a rule setting that priority would have saved the
 * correction. An association "facts → priority" is suggested when enough incidents support it (`support`,
 * the corrected ones) and the Wilson lower bound of corrected / all-with-those-facts clears `minConfidence`,
 * the same bound the runbook ranker uses so 3 of 3 never outranks 47 of 50.
 *
 * Team and escalation-policy changes are not mined: automation has no team action, and a policy change after
 * creation is not recorded anywhere a query could read it.
 */
export const AUTOMATION_MINING = {
  minSupport: 5,
  minIncidents: 8,
  minConfidence: 0.5,
  maxSuggestions: 5,
} as const;

/** Incidents grouped by their opening facts and where a person took the priority, from the loader. */
export interface MiningGroup {
  severity: string | null;
  source: string | null;
  incidents: number;
  /** Corrections by final priority: incidents in the group a person changed to that priority. */
  correctedTo: Partial<Record<Priority, number>>;
}

export interface MinedRuleSuggestion {
  /** Stable identity of the association, for the insight key. */
  key: string;
  rule: SuggestedRule;
  incidents: number;
  corrected: number;
  confidence: number;
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

export function mineAutomationRules(
  groups: readonly MiningGroup[],
  options: {
    /** Signatures of rules that already exist (`ruleSignature`), so they are not suggested again. */
    existing?: ReadonlySet<string>;
    limits?: Partial<typeof AUTOMATION_MINING>;
  } = {}
): MinedRuleSuggestion[] {
  const limits = { ...AUTOMATION_MINING, ...options.limits };
  const totals = new Map<
    string,
    { facts: Facts; incidents: number; correctedTo: Map<Priority, number> }
  >();
  for (const group of groups) {
    for (const facts of antecedents(group)) {
      const key = factsKey(facts);
      const entry = totals.get(key) ?? { facts, incidents: 0, correctedTo: new Map() };
      entry.incidents += group.incidents;
      for (const [priority, count] of Object.entries(group.correctedTo) as Array<
        [Priority, number]
      >)
        entry.correctedTo.set(priority, (entry.correctedTo.get(priority) ?? 0) + count);
      totals.set(key, entry);
    }
  }

  const candidates: Array<MinedRuleSuggestion & { facts: Facts; priority: Priority }> = [];
  for (const { facts, incidents, correctedTo } of totals.values()) {
    if (incidents < limits.minIncidents) continue;
    for (const [priority, corrected] of correctedTo) {
      if (corrected < limits.minSupport) continue;
      const confidence = wilsonLowerBound(corrected, incidents);
      if (confidence < limits.minConfidence) continue;
      const rule = suggestionRule(facts, priority);
      candidates.push({
        key: `${factsKey(facts)}>${priority}`,
        rule,
        incidents,
        corrected,
        confidence: Math.round(confidence * 100) / 100,
        facts,
        priority,
      });
    }
  }

  // The most general association wins: a narrower one setting the same priority adds nothing.
  const kept = candidates.filter(
    candidate =>
      !candidates.some(
        other =>
          other !== candidate &&
          other.priority === candidate.priority &&
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
    .map(({ facts: _facts, priority: _priority, ...suggestion }) => suggestion);
}

function suggestionRule(facts: Facts, priority: Priority): SuggestedRule {
  const conditions = FIELDS.flatMap(field =>
    facts[field] === undefined
      ? []
      : [{ fieldKey: field, operator: 'EQ' as const, value: facts[field] as string }]
  );
  const rule = { conditions, priority };
  return { name: defaultSuggestionName(rule), ...rule };
}

/** What a rule does, ignoring its name and id, to recognise a suggestion that already exists. */
export function ruleSignature(rule: {
  conditions: ReadonlyArray<{ fieldKey: string; operator: string; value?: unknown }>;
  priority?: string;
}): string {
  const conditions = rule.conditions
    .map(c => `${c.fieldKey}|${c.operator}|${String(c.value ?? '').toLowerCase()}`)
    .sort();
  return `${conditions.join('&')}>${rule.priority ?? ''}`;
}
