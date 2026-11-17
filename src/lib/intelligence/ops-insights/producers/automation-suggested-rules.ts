import 'server-only';
/* eslint-disable security/detect-object-injection -- Priority keys come from the closed PRIORITIES list. */
import { Prisma } from '@prisma/client';
import { PRIORITIES, snapshotSchema } from '@/lib/automation/contract';
import { PRIORITY_CHANGE_MESSAGES } from '@/lib/automation/replay';
import { describeConditions, suggestedRuleHref } from '@/lib/automation/suggested-rule';
import {
  AUTOMATION_MINING,
  mineAutomationRules,
  ruleSignature,
  type MiningGroup,
} from '../../learning/automation-mining';
import type { OpsInsightItem } from '../contract';
import type { OpsInsightProducer } from '../producer';

/**
 * Suggested rules mined from history (plan J1.3), one insight per suggestion. Each links to the automation
 * workspace with the rule pre-filled; nothing is added to the draft until a person adds it there, and it is
 * published through the review whose replay step shows what it would have changed.
 *
 * Reads: one statement over the newest INCIDENT_SAMPLE settled public incidents on
 * idx_incident_sla_by_service ("serviceId", "createdAt", "status"), each with its opening alert on
 * idx_alert_incident_cursor, grouped in the database and capped at AUTOMATION_MINING.maxGroups groups; the
 * active version and draft snapshots; and, only when people handed incidents to a team, the first steps of
 * the policies that page those teams (EscalationRule targetTeamId and policyId indexes).
 * Only public incidents are mined, so a suggestion never carries a value from an incident some viewers of
 * the service may not open.
 */
export interface AutomationSuggestedRulesInput {
  serviceId: string;
  groups: MiningGroup[];
  existing: string[];
  /** Team id -> the one policy whose first step pages it (not the service's own); see mineAutomationRules. */
  teamPolicies?: Record<string, string>;
}

const WINDOW_DAYS = 30;
const INCIDENT_SAMPLE = 2000;
const SETTLE_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
const VALUE_MAX = 64;

type Row = {
  severity: string | null;
  source: string | null;
  correctedTo: string | null;
  correctedTeam: string | null;
  incidents: number;
};
/** Bounds the policy lookup for team hand-offs; a team paged first by more policies is ambiguous anyway. */
const TEAM_STEP_SAMPLE = 500;

/** The production statement, exported so the query-plan gate explains exactly what the lane runs. */
export function automationMiningSql(serviceId: string, now: Date): Prisma.Sql {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const settled = new Date(now.getTime() - SETTLE_MS);
  return Prisma.sql`
    SELECT opening."severity", opening."source",
      CASE WHEN EXISTS (SELECT 1 FROM "IncidentEvent" e WHERE e."incidentId" = i."id"
        AND ${PRIORITY_CHANGE_MESSAGES}) THEN i."priority" END AS "correctedTo",
      CASE WHEN i."teamId" IS NOT NULL AND EXISTS (SELECT 1 FROM "IncidentEvent" e WHERE e."incidentId" = i."id"
        AND e."type" = 'ASSIGNMENT' AND e."message" LIKE 'Incident assigned to team:%') THEN i."teamId" END
        AS "correctedTeam",
      count(*)::int AS "incidents"
    FROM (
      SELECT "id", "priority", "teamId" FROM "Incident"
      WHERE "serviceId" = ${serviceId} AND "createdAt" >= ${since} AND "createdAt" < ${settled}
        AND "visibility" = 'PUBLIC'
      ORDER BY "createdAt" DESC LIMIT ${INCIDENT_SAMPLE}
    ) i
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN length(a."payload"->>'severity') <= ${VALUE_MAX} THEN lower(a."payload"->>'severity') END AS "severity",
        CASE WHEN length(a."payload"->>'source') <= ${VALUE_MAX} THEN lower(a."payload"->>'source') END AS "source"
      FROM "Alert" a WHERE a."incidentId" = i."id"
      ORDER BY a."createdAt" ASC, a."id" ASC LIMIT 1
    ) opening
    GROUP BY 1, 2, 3, 4
    ORDER BY "incidents" DESC
    LIMIT ${AUTOMATION_MINING.maxGroups}`;
}

/** Enabled one-action priority and policy rules already in the active version or the draft. */
function existingSignatures(...snapshots: unknown[]): string[] {
  const signatures = new Set<string>();
  for (const raw of snapshots) {
    const parsed = snapshotSchema.safeParse(raw);
    if (!parsed.success) continue;
    for (const rule of parsed.data.rules) {
      const action = rule.actions[0];
      if (!rule.enabled || rule.actions.length !== 1) continue;
      if (action.type === 'SET_PRIORITY')
        signatures.add(ruleSignature({ conditions: rule.conditions, priority: action.value }));
      if (action.type === 'USE_ESCALATION_POLICY')
        signatures.add(ruleSignature({ conditions: rule.conditions, policyId: action.policyId }));
    }
  }
  return [...signatures].sort();
}

/**
 * For each team, the one live policy whose first step pages it, unless that is already the service's own
 * policy (routing there changes nothing). A team paged first by several policies gets none.
 */
async function policiesPagingFirst(
  tx: Prisma.TransactionClient,
  teamIds: string[],
  servicePolicyId: string | null
): Promise<Record<string, string>> {
  if (teamIds.length === 0) return {};
  const steps = await tx.escalationRule.findMany({
    where: { targetType: 'TEAM', targetTeamId: { in: teamIds }, policy: { archivedAt: null } },
    select: { policyId: true, stepOrder: true, targetTeamId: true },
    orderBy: { id: 'asc' },
    take: TEAM_STEP_SAMPLE,
  });
  if (steps.length === 0) return {};
  const firsts = await tx.escalationRule.groupBy({
    by: ['policyId'],
    where: { policyId: { in: [...new Set(steps.map(step => step.policyId))] } },
    _min: { stepOrder: true },
  });
  const first = new Map(firsts.map(row => [row.policyId, row._min.stepOrder]));
  const byTeam = new Map<string, Set<string>>();
  for (const step of steps) {
    if (!step.targetTeamId || first.get(step.policyId) !== step.stepOrder) continue;
    byTeam.set(step.targetTeamId, (byTeam.get(step.targetTeamId) ?? new Set()).add(step.policyId));
  }
  const out: Record<string, string> = {};
  for (const [teamId, policies] of [...byTeam].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [only] = policies;
    if (policies.size === 1 && only !== servicePolicyId) out[teamId] = only;
  }
  return out;
}

export const automationSuggestedRulesProducer: OpsInsightProducer<AutomationSuggestedRulesInput> = {
  kind: 'automation.suggested_rule',
  version: 2,
  area: 'automation',
  scopeType: 'SERVICE',

  async loadInput(scope, { tx, now }) {
    const rows = await tx.$queryRaw<Row[]>(automationMiningSql(scope.id, now));
    const groups = new Map<string, MiningGroup>();
    const teams = new Set<string>();
    for (const row of rows) {
      const key = JSON.stringify([row.severity, row.source]);
      const group = groups.get(key) ?? {
        severity: row.severity,
        source: row.source,
        incidents: 0,
        correctedTo: {},
      };
      group.incidents += row.incidents;
      const priority = PRIORITIES.find(value => value === row.correctedTo);
      if (priority)
        group.correctedTo[priority] = (group.correctedTo[priority] ?? 0) + row.incidents;
      if (row.correctedTeam) {
        group.teamTo = group.teamTo ?? {};
        group.teamTo[row.correctedTeam] = (group.teamTo[row.correctedTeam] ?? 0) + row.incidents;
        teams.add(row.correctedTeam);
      }
      groups.set(key, group);
    }
    if (
      teams.size === 0 &&
      ![...groups.values()].some(group => Object.keys(group.correctedTo).length > 0)
    )
      return null;

    const service = teams.size
      ? await tx.service.findUnique({
          where: { id: scope.id },
          select: { escalationPolicyId: true },
        })
      : null;
    const teamPolicies = await policiesPagingFirst(
      tx,
      [...teams].sort(),
      service?.escalationPolicyId ?? null
    );
    const config = await tx.serviceAutomationConfig.findUnique({
      where: { serviceId: scope.id },
      select: {
        activeVersion: { select: { snapshot: true } },
        draft: { select: { snapshot: true } },
      },
    });
    return {
      serviceId: scope.id,
      groups: [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, group]) => group),
      existing: existingSignatures(config?.activeVersion?.snapshot, config?.draft?.snapshot),
      ...(Object.keys(teamPolicies).length > 0 ? { teamPolicies } : {}),
    };
  },

  derive(input) {
    return mineAutomationRules(input.groups, {
      existing: new Set(input.existing),
      teamPolicies: input.teamPolicies,
    }).map((suggestion): OpsInsightItem => {
      const when = describeConditions(suggestion.rule.conditions);
      const share = Math.round((suggestion.corrected / suggestion.incidents) * 100);
      if (!suggestion.rule.priority)
        return {
          key: `rule:${suggestion.key}`,
          severity: 'INFO',
          title: `Suggested rule: route through the team's policy when ${when}`.slice(0, 140),
          summary:
            `People handed ${suggestion.corrected} of ${suggestion.incidents} incidents where ${when} to the same team (${share}%). A rule would route them through the escalation policy whose first step pages that team. Replay it before you publish.`.slice(
              0,
              400
            ),
          evidence: {
            window: `last ${WINDOW_DAYS} days, public incidents`,
            facts: [
              { label: 'Incidents with these facts', value: String(suggestion.incidents) },
              { label: 'Handed to that team by a person', value: String(suggestion.corrected) },
              {
                label: 'Confidence (lower bound)',
                value: `${Math.round(suggestion.confidence * 100)}%`,
              },
            ],
          },
          draftHref: suggestedRuleHref(input.serviceId, suggestion.rule),
        };
      return {
        key: `rule:${suggestion.key}`,
        severity: 'INFO',
        title: `Suggested rule: set ${suggestion.rule.priority} when ${when}`.slice(0, 140),
        summary:
          `People changed ${suggestion.corrected} of ${suggestion.incidents} incidents where ${when} to ${suggestion.rule.priority} (${share}%). A rule would set it when the incident opens. Replay it before you publish.`.slice(
            0,
            400
          ),
        evidence: {
          window: `last ${WINDOW_DAYS} days, public incidents`,
          facts: [
            { label: 'Incidents with these facts', value: String(suggestion.incidents) },
            {
              label: `Changed to ${suggestion.rule.priority} by a person`,
              value: String(suggestion.corrected),
            },
            {
              label: 'Confidence (lower bound)',
              value: `${Math.round(suggestion.confidence * 100)}%`,
            },
          ],
        },
        draftHref: suggestedRuleHref(input.serviceId, suggestion.rule),
      };
    });
  },
};
