import 'server-only';
import { Prisma } from '@prisma/client';
import { PRIORITIES, snapshotSchema } from '@/lib/automation/contract';
import { PRIORITY_CHANGE_MESSAGES } from '@/lib/automation/replay';
import { describeConditions, suggestedRuleHref } from '@/lib/automation/suggested-rule';
import {
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
 * idx_alert_incident_cursor, grouped in the database; and the active version and draft snapshots.
 * Only public incidents are mined, so a suggestion never carries a value from an incident some viewers of
 * the service may not open.
 */
export interface AutomationSuggestedRulesInput {
  serviceId: string;
  groups: MiningGroup[];
  existing: string[];
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
  incidents: number;
};

/** The production statement, exported so the query-plan gate explains exactly what the lane runs. */
export function automationMiningSql(serviceId: string, now: Date): Prisma.Sql {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const settled = new Date(now.getTime() - SETTLE_MS);
  return Prisma.sql`
    SELECT opening."severity", opening."source",
      CASE WHEN EXISTS (SELECT 1 FROM "IncidentEvent" e WHERE e."incidentId" = i."id"
        AND ${PRIORITY_CHANGE_MESSAGES}) THEN i."priority" END AS "correctedTo",
      count(*)::int AS "incidents"
    FROM (
      SELECT "id", "priority" FROM "Incident"
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
    GROUP BY 1, 2, 3
    LIMIT 1000`;
}

/** Enabled one-action priority rules already in the active version or the draft. */
function existingSignatures(...snapshots: unknown[]): string[] {
  const signatures = new Set<string>();
  for (const raw of snapshots) {
    const parsed = snapshotSchema.safeParse(raw);
    if (!parsed.success) continue;
    for (const rule of parsed.data.rules) {
      const action = rule.actions[0];
      if (!rule.enabled || rule.actions.length !== 1 || action.type !== 'SET_PRIORITY') continue;
      signatures.add(ruleSignature({ conditions: rule.conditions, priority: action.value }));
    }
  }
  return [...signatures].sort();
}

export const automationSuggestedRulesProducer: OpsInsightProducer<AutomationSuggestedRulesInput> = {
  kind: 'automation.suggested_rule',
  version: 1,
  area: 'automation',
  scopeType: 'SERVICE',

  async loadInput(scope, { tx, now }) {
    const rows = await tx.$queryRaw<Row[]>(automationMiningSql(scope.id, now));
    const groups = new Map<string, MiningGroup>();
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
      groups.set(key, group);
    }
    if (![...groups.values()].some(group => Object.keys(group.correctedTo).length > 0)) return null;

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
    };
  },

  derive(input) {
    return mineAutomationRules(input.groups, { existing: new Set(input.existing) }).map(
      (suggestion): OpsInsightItem => {
        const when = describeConditions(suggestion.rule.conditions);
        const share = Math.round((suggestion.corrected / suggestion.incidents) * 100);
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
      }
    );
  },
};
