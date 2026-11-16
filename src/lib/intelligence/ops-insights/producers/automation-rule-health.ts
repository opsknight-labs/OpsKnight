import 'server-only';
import { Prisma } from '@prisma/client';
import { compileAutomation } from '@/lib/automation/compiler';
import {
  OVERRIDE_MESSAGES,
  OVERRIDE_WINDOW_MINUTES,
  replayStoredEvents,
} from '@/lib/automation/replay';
import { loadReplayEnvironment } from '@/lib/automation/replay-run';
import { automationHref } from '@/lib/automation/suggested-rule';
import { OPS_ROLLUPS, queryOpsRollup } from '@/lib/metric-rollup';
import type { OpsInsightItem } from '../contract';
import type { OpsInsightProducer } from '../producer';

/**
 * Rule health from real traffic (plan J1.2): what the active automation version does to the incidents it
 * actually receives, next to the static lint ConfigurationHealth already shows.
 *
 * - never matched: a route rule with no match in the version's rule-match rollup (ops.automation.rule_match)
 *   over 30 days; an enrichment rule with no match in a replay sample (the rollup records route rules only);
 * - always shadowed: in the replay sample, a route rule's conditions held but an earlier rule always won;
 * - unmapped field: a context field whose value could not be normalized in a large share of the sample;
 * - overridden: incidents a rule routed whose priority, urgency or assignee a person changed within
 *   OVERRIDE_WINDOW_MINUTES (from IncidentEvent + IncidentAutomationDecision);
 * - never acknowledged: an escalation policy automation routed incidents to that never acknowledged one.
 *
 * Reads, all bounded: one rollup read on idx_metric_rollup_subject, one statement over the newest
 * ROUTE_SAMPLE decisions on ("serviceId", "createdAt"), and one replay page of SAMPLE_EVENTS events.
 * Stored text names no rule, field or policy: a person who may read the service but not its automation
 * still sees the inbox row. Keys carry the rule id or field key, and the automation workspace, which only
 * automation readers open, puts the names back (see AutomationInsights.tsx).
 */
export interface AutomationRuleHealthInput {
  serviceId: string;
  /** Whole days the active version has been published, capped at WINDOW_DAYS. */
  versionDays: number;
  /** Decisions the active version made over the window, from the rollup. */
  decisions: number;
  routeRules: Array<{ id: string; matched: number }>;
  sample: {
    events: number;
    rules: Array<{ id: string; phase: 'ENRICH' | 'ROUTE'; matched: number; shadowed: number }>;
    unmapped: Array<{ field: string; count: number }>;
  };
  /** Settled LIVE decisions per route rule (null = no rule matched, the service default). */
  routes: Array<{ ruleId: string | null; decisions: number; overridden: number }>;
  policies: Array<{ policyId: string; decisions: number; acknowledged: number }>;
}

const WINDOW_DAYS = 30;
const SAMPLE_DAYS = 7;
const SAMPLE_EVENTS = 500;
const ROUTE_SAMPLE = 2000;
/** Incidents younger than this have not had a fair chance to be acknowledged or corrected. */
const SETTLE_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

type RouteRow = {
  ruleId: string | null;
  policyId: string | null;
  decisions: number;
  acknowledged: number;
  overridden: number;
};

/** The production statement, exported so the query-plan gate explains exactly what the lane runs. */
export function automationRouteOutcomesSql(serviceId: string, now: Date): Prisma.Sql {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const settled = new Date(now.getTime() - SETTLE_MS);
  return Prisma.sql`
    SELECT d."matchedRouteRuleId" AS "ruleId", d."escalationPolicyId" AS "policyId", count(*)::int AS "decisions",
      (count(*) FILTER (WHERE i."acknowledgedAt" IS NOT NULL))::int AS "acknowledged",
      (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "IncidentEvent" e WHERE e."incidentId" = i."id"
        AND e."createdAt" <= i."createdAt" + ${OVERRIDE_WINDOW_MINUTES}::int * interval '1 minute'
        AND ${OVERRIDE_MESSAGES})))::int AS "overridden"
    FROM (
      SELECT "incidentId", "matchedRouteRuleId", "escalationPolicyId"
      FROM "IncidentAutomationDecision"
      WHERE "serviceId" = ${serviceId} AND "createdAt" >= ${since} AND "createdAt" < ${settled}
        AND "mode" = 'LIVE'
      ORDER BY "createdAt" DESC LIMIT ${ROUTE_SAMPLE}
    ) d
    JOIN "Incident" i ON i."id" = d."incidentId"
    GROUP BY d."matchedRouteRuleId", d."escalationPolicyId"
    LIMIT 500`;
}

export const automationRuleHealthProducer: OpsInsightProducer<AutomationRuleHealthInput> = {
  kind: 'automation.rule_health',
  version: 1,
  area: 'automation',
  scopeType: 'SERVICE',

  async loadInput(scope, { tx, now }) {
    const config = await tx.serviceAutomationConfig.findUnique({
      where: { serviceId: scope.id },
      select: {
        mode: true,
        activeVersion: { select: { id: true, snapshot: true, publishedAt: true } },
      },
    });
    const version = config?.activeVersion;
    if (!version || config.mode === 'DISABLED') return null;
    const { compiled, issues } = compileAutomation(version.snapshot);
    if (issues.some(issue => issue.level === 'ERROR')) return null;

    const from = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
    const rollup = await queryOpsRollup(
      OPS_ROLLUPS.automationRuleMatch,
      { from, to: now, subjectKey: version.id },
      tx
    );
    const matchedByRule = new Map<string, number>();
    let decisions = 0;
    for (const point of rollup) {
      decisions += point.count;
      const ruleId = (point.tags as { ruleId?: unknown } | null)?.ruleId;
      if (typeof ruleId === 'string')
        matchedByRule.set(ruleId, (matchedByRule.get(ruleId) ?? 0) + point.count);
    }

    const environment = await loadReplayEnvironment(tx, scope.id, null);
    const sample = await replayStoredEvents({
      compiled,
      serviceId: scope.id,
      environment,
      windowStart: new Date(now.getTime() - SAMPLE_DAYS * DAY_MS),
      windowEnd: now,
      run: work => work(tx),
      batchSize: SAMPLE_EVENTS,
      maxEvents: SAMPLE_EVENTS,
    });

    const rows = await tx.$queryRaw<RouteRow[]>(automationRouteOutcomesSql(scope.id, now));
    const routes = new Map<string, AutomationRuleHealthInput['routes'][number]>();
    const policies = new Map<string, AutomationRuleHealthInput['policies'][number]>();
    for (const row of rows) {
      const route = routes.get(row.ruleId ?? '') ?? {
        ruleId: row.ruleId,
        decisions: 0,
        overridden: 0,
      };
      route.decisions += row.decisions;
      route.overridden += row.overridden;
      routes.set(row.ruleId ?? '', route);
      if (!row.policyId) continue;
      const policy = policies.get(row.policyId) ?? {
        policyId: row.policyId,
        decisions: 0,
        acknowledged: 0,
      };
      policy.decisions += row.decisions;
      policy.acknowledged += row.acknowledged;
      policies.set(row.policyId, policy);
    }

    const byId = <T extends { ruleId: string | null }>(a: T, b: T) =>
      (a.ruleId ?? '') < (b.ruleId ?? '') ? -1 : 1;
    return {
      serviceId: scope.id,
      versionDays: Math.min(
        WINDOW_DAYS,
        Math.floor((now.getTime() - version.publishedAt.getTime()) / DAY_MS)
      ),
      decisions,
      routeRules: compiled.rules
        .filter(rule => rule.enabled && rule.phase === 'ROUTE')
        .map(rule => ({ id: rule.id, matched: matchedByRule.get(rule.id) ?? 0 })),
      sample: {
        events: sample.eventsEvaluated,
        rules: sample.rules.map(rule => ({
          id: rule.ruleId,
          phase: rule.phase,
          matched: rule.matched,
          shadowed: rule.shadowed,
        })),
        unmapped: Object.entries(sample.unmappedFields)
          .map(([field, count]) => ({ field, count }))
          .sort((a, b) => (a.field < b.field ? -1 : 1)),
      },
      routes: [...routes.values()].sort(byId),
      policies: [...policies.values()].sort((a, b) => (a.policyId < b.policyId ? -1 : 1)),
    };
  },

  derive(input) {
    const items: OpsInsightItem[] = [];
    const ruleHref = (ruleId: string) => automationHref(input.serviceId, { ruleId });
    const share = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;
    const sampleWindow = `last ${input.sample.events} incidents (up to ${SAMPLE_DAYS} days)`;

    // Always shadowed explains "never matched", so a shadowed rule is reported once, as shadowed.
    const shadowed = new Set<string>();
    if (input.sample.events >= 50) {
      for (const rule of input.sample.rules) {
        if (rule.phase !== 'ROUTE' || rule.matched > 0 || rule.shadowed < 5) continue;
        shadowed.add(rule.id);
        items.push({
          key: `shadowed:${rule.id}`,
          severity: 'WARNING',
          title: 'A route rule is always decided by an earlier rule',
          summary: `Its conditions held for ${rule.shadowed} recent incidents, but an earlier route rule matched first every time, so this rule never routes anything. Move it up or narrow the earlier rule.`,
          evidence: {
            window: sampleWindow,
            facts: [
              { label: 'Conditions held', value: String(rule.shadowed) },
              { label: 'Times it routed', value: '0' },
            ],
          },
          draftHref: ruleHref(rule.id),
        });
      }
    }

    if (input.versionDays >= 7 && input.decisions >= 50) {
      for (const rule of input.routeRules) {
        if (rule.matched > 0 || shadowed.has(rule.id)) continue;
        items.push({
          key: `never-matched:${rule.id}`,
          severity: 'INFO',
          title: `A route rule has not matched in ${input.versionDays} days`,
          summary: `None of the ${input.decisions} incidents automation evaluated in that time matched this route rule. Check its conditions against what the integrations send, or remove it.`,
          evidence: {
            window: `last ${input.versionDays} days`,
            facts: [
              { label: 'Incidents evaluated', value: String(input.decisions) },
              { label: 'Matched this rule', value: '0' },
            ],
          },
          draftHref: ruleHref(rule.id),
        });
      }
    }
    if (input.sample.events >= 50) {
      for (const rule of input.sample.rules) {
        if (rule.phase !== 'ENRICH' || rule.matched > 0) continue;
        items.push({
          key: `never-matched:${rule.id}`,
          severity: 'INFO',
          title: 'An enrichment rule did not match any recent incident',
          summary: `Replaying the ${input.sample.events} most recent incidents, this enrichment rule never applied. Check its conditions against what the integrations send, or remove it.`,
          evidence: {
            window: sampleWindow,
            facts: [
              { label: 'Incidents replayed', value: String(input.sample.events) },
              { label: 'Matched this rule', value: '0' },
            ],
          },
          draftHref: ruleHref(rule.id),
        });
      }
    }

    if (input.sample.events >= 50) {
      for (const { field, count } of input.sample.unmapped) {
        if (count / input.sample.events < 0.2) continue;
        items.push({
          key: `unmapped:${field}`,
          severity: count / input.sample.events >= 0.5 ? 'WARNING' : 'INFO',
          title: `A context field is unmapped for ${share(count, input.sample.events)} of incidents`,
          summary: `${count} of the ${input.sample.events} most recent incidents carried a value for this field that is not one of its allowed values or aliases, so conditions on it read as unknown. Add the values as aliases.`,
          evidence: {
            window: sampleWindow,
            facts: [
              { label: 'Incidents replayed', value: String(input.sample.events) },
              { label: 'With an unmapped value', value: String(count) },
            ],
          },
          draftHref: automationHref(input.serviceId),
        });
      }
    }

    for (const route of input.routes) {
      if (route.decisions < 10 || route.overridden / route.decisions < 0.3) continue;
      const subject = route.ruleId ? 'a route rule' : 'the service default';
      items.push({
        key: `overridden:${route.ruleId ?? 'default'}`,
        severity: 'WARNING',
        title: `Responders often correct incidents routed by ${subject}`,
        summary: `Of ${route.decisions} incidents routed by ${subject}, a person changed the priority, urgency or assignee of ${route.overridden} within ${OVERRIDE_WINDOW_MINUTES} minutes. It may be sending them to the wrong place or priority.`,
        evidence: {
          window: `last ${WINDOW_DAYS} days`,
          facts: [
            { label: 'Incidents routed', value: String(route.decisions) },
            {
              label: `Corrected within ${OVERRIDE_WINDOW_MINUTES} minutes`,
              value: String(route.overridden),
            },
          ],
        },
        draftHref: route.ruleId ? ruleHref(route.ruleId) : automationHref(input.serviceId),
      });
    }

    for (const policy of input.policies) {
      if (policy.decisions < 10 || policy.acknowledged > 0) continue;
      items.push({
        key: `policy-no-ack:${policy.policyId}`,
        severity: 'WARNING',
        title: 'Incidents automation routes to one policy are never acknowledged',
        summary: `Automation sent ${policy.decisions} incidents to the same escalation policy and none was acknowledged. Check who that policy pages, or route these incidents elsewhere.`,
        evidence: {
          window: `last ${WINDOW_DAYS} days`,
          facts: [
            { label: 'Incidents routed', value: String(policy.decisions) },
            { label: 'Acknowledged', value: '0' },
          ],
          examples: [
            {
              label: 'Open the escalation policy',
              href: `/policies/${encodeURIComponent(policy.policyId)}`,
            },
          ],
        },
        draftHref: automationHref(input.serviceId),
      });
    }
    return items;
  },
};
