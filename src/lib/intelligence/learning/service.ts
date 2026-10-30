import 'server-only';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { MAX_CORRELATION_RULES_PER_POLICY, type PolicyDefinition } from '../contract';
import { withDbBudget } from '../jobs/db-budget';
import { getIntelligenceSettings, publishPolicyVersion, resolveEffectivePolicy, type IntelligenceActor } from '../settings/service';
import type { ReplayIncident } from '../evaluation/simulate';
import { mineRuleSuggestions, type JudgedPair, type MiningIncident, type RuleSuggestion } from './rule-mining';

/** Human decisions examined, newest first. */
export const MAX_JUDGED_PAIRS = 2000;
/** Recent incidents replayed to check that a rule is not too broad. */
export const MAX_REPLAY_INCIDENTS = 5000;
export const LEARNING_LOOKBACK_DAYS = 90;
const REPLAY_DAYS = 30;
const DAY_MS = 86_400_000;

function labelsOf(value: Prisma.JsonValue | undefined): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

const incidentSelect = {
  id: true,
  serviceId: true,
  urgency: true,
  createdAt: true,
  intelligenceFingerprint: { select: { template: true, labels: true } },
} as const;

type SelectedIncident = {
  id: string;
  serviceId: string;
  urgency: string;
  createdAt: Date;
  intelligenceFingerprint: { template: string; labels: Prisma.JsonValue } | null;
};

function toMining(incident: SelectedIncident): MiningIncident | null {
  if (!incident.intelligenceFingerprint) return null;
  return {
    id: incident.id,
    serviceId: incident.serviceId,
    urgency: incident.urgency,
    createdAt: incident.createdAt,
    template: incident.intelligenceFingerprint.template,
    labels: labelsOf(incident.intelligenceFingerprint.labels),
  };
}

/**
 * Proposes correlation rules learned from people's link decisions. Read-only and bounded: a fixed
 * number of recent decisions and a fixed replay sample, inside a statement budget. Only rule shapes
 * and counts are returned, never incident content.
 */
export async function suggestCorrelationRules(now: Date = new Date()): Promise<RuleSuggestion[]> {
  const [settings, policy] = await Promise.all([getIntelligenceSettings(), resolveEffectivePolicy(null)]);
  const since = new Date(now.getTime() - LEARNING_LOOKBACK_DAYS * DAY_MS);
  const replaySince = new Date(now.getTime() - REPLAY_DAYS * DAY_MS);

  const { pairs, recent } = await withDbBudget({ maxDbMs: Math.max(settings.maxDbMs, 10_000) }, async tx => {
    const relationships = await tx.incidentRelationship.findMany({
      where: {
        type: { in: ['RELATED', 'DUPLICATE_OF'] },
        decision: { in: ['ACCEPTED', 'REJECTED', 'REVERTED'] },
        updatedAt: { gte: since },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: MAX_JUDGED_PAIRS,
      select: { decision: true, source: { select: incidentSelect }, target: { select: incidentSelect } },
    });
    const fingerprints = await tx.incidentFingerprint.findMany({
      where: { incidentCreatedAt: { gte: replaySince, lte: now } },
      orderBy: { incidentCreatedAt: 'desc' },
      take: MAX_REPLAY_INCIDENTS,
      select: { incidentId: true, serviceId: true, template: true, labels: true, incidentCreatedAt: true, incident: { select: { urgency: true } } },
    });
    return { pairs: relationships, recent: fingerprints };
  });

  const judged: JudgedPair[] = [];
  for (const relationship of pairs) {
    const a = toMining(relationship.source);
    const b = toMining(relationship.target);
    if (a && b) judged.push({ a, b, linked: relationship.decision === 'ACCEPTED' });
  }
  const replay: ReplayIncident[] = recent.map(row => ({
    id: row.incidentId,
    serviceId: row.serviceId,
    urgency: row.incident.urgency,
    createdAt: row.incidentCreatedAt,
    template: row.template,
    labels: labelsOf(row.labels),
  }));
  return mineRuleSuggestions(judged, replay, policy.definition.correlation.rules);
}

/**
 * Adds one learned rule to the global policy as a new, audited policy version in the current mode.
 * The suggestion is recomputed and must still be offered, so a stale page or a crafted request can
 * never publish an arbitrary rule through this path.
 */
export async function adoptRuleSuggestion(
  input: { ruleId: string; expectedHeadVersion: number },
  actor: IntelligenceActor
): Promise<{ version: number; suggestion: RuleSuggestion }> {
  const suggestion = (await suggestCorrelationRules()).find(candidate => candidate.rule.id === input.ruleId);
  if (!suggestion) {
    throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'That suggestion is no longer offered. Refresh to see the current ones.' });
  }
  const current = await resolveEffectivePolicy(null);
  if (current.definition.correlation.rules.length >= MAX_CORRELATION_RULES_PER_POLICY) {
    throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: `A policy can hold at most ${MAX_CORRELATION_RULES_PER_POLICY} rules.` });
  }
  const definition: PolicyDefinition = {
    ...current.definition,
    correlation: { ...current.definition.correlation, rules: [...current.definition.correlation.rules, suggestion.rule] },
  };
  const result = await publishPolicyVersion(
    {},
    {
      mode: current.mode,
      definition,
      reason: `Added learned rule ${suggestion.rule.id}: reproduces ${suggestion.support} confirmed links, ${Math.round(suggestion.precision * 100)}% precision on reviewed pairs`,
      expectedHeadVersion: input.expectedHeadVersion,
    },
    actor
  );
  return { version: result.version, suggestion };
}
