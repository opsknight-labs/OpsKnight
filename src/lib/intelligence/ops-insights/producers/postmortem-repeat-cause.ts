import 'server-only';
import { Prisma } from '@prisma/client';
import type { OpsInsightItem, OpsInsightSeverity } from '../contract';
import type { OpsInsightProducer } from '../producer';

/**
 * Repeat cause with an overdue follow-up (plan J4), scope SERVICE, area postmortems.
 *
 * A problem (the masked title in `IncidentFingerprint.template`) came back on this service at least twice in
 * 90 days while an action item written for one of its occurrences is past due and not completed.
 *
 * The stored insight names no incident, template or action-item text: only counts, days and ids. A viewer
 * who opens an example link sees the text under their own read rules.
 *
 * Reads: two statements. Problems on idx_incident_fingerprint_service_recent (serviceId, incidentCreatedAt),
 * capped by a scan LIMIT; overdue items through idx_incident_fingerprint_problem (serviceId, template, …) and
 * ActionItem (incidentId, status), capped by LIMIT.
 */
export interface RepeatCauseInput {
  windowDays: number;
  problems: Array<{
    /** Stable identity of the problem on this service (the template hash). */
    key: string;
    occurrences: number;
    lastSeenDay: string;
    latestIncidentId: string;
    overdue: Array<{
      id: string;
      incidentId: string;
      high: boolean;
      dueDay: string;
      daysLate: number;
    }>;
  }>;
}

export const REPEAT_CAUSE_KIND = 'postmortem.repeat-cause';
export const REPEAT_CAUSE_LIMITS = {
  windowDays: 90,
  /** Most recent fingerprints read per service; an older tail inside the window is not counted. */
  scan: 5_000,
  problems: 20,
  overdueItems: 100,
  /** Days late are capped so a long-forgotten item does not change the input hash every day. */
  daysLate: 90,
} as const;

const DAY_MS = 86_400_000;
const day = (date: Date) => date.toISOString().slice(0, 10);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

type ProblemRow = {
  key: string;
  template: string;
  occurrences: number;
  lastSeen: Date;
  latest: string;
};
type ItemRow = {
  id: string;
  incidentId: string;
  priority: string;
  dueDate: Date;
  template: string;
};

/** Recurring problems of one service in the window. Exported for the query-plan gate. */
export function repeatCauseProblemsSql(serviceId: string, now: Date): Prisma.Sql {
  const since = new Date(now.getTime() - REPEAT_CAUSE_LIMITS.windowDays * DAY_MS);
  return Prisma.sql`
    SELECT coalesce(max("templateHash"), md5("template")) AS key, "template",
           count(*)::int AS occurrences,
           max("incidentCreatedAt") AS "lastSeen",
           (array_agg("incidentId" ORDER BY "incidentCreatedAt" DESC))[1] AS latest
    FROM (SELECT "incidentId", "template", "templateHash", "incidentCreatedAt" FROM "IncidentFingerprint"
          WHERE "serviceId" = ${serviceId} AND "incidentCreatedAt" >= ${since}
          ORDER BY "incidentCreatedAt" DESC LIMIT ${REPEAT_CAUSE_LIMITS.scan}) recent
    WHERE "template" <> ''
    GROUP BY "template"
    HAVING count(*) >= 2
    ORDER BY count(*) DESC, max("incidentCreatedAt") DESC
    LIMIT ${REPEAT_CAUSE_LIMITS.problems}`;
}

/** Overdue, unfinished action items of any occurrence of these problems. Exported for the query-plan gate. */
export function repeatCauseOverdueSql(
  serviceId: string,
  templates: string[],
  now: Date
): Prisma.Sql {
  return Prisma.sql`
    SELECT a."id", a."incidentId", a."priority"::text AS priority, a."dueDate", f."template"
    FROM "IncidentFingerprint" f
    JOIN "ActionItem" a ON a."incidentId" = f."incidentId"
    WHERE f."serviceId" = ${serviceId} AND f."template" = ANY(${templates})
      AND a."status" <> 'COMPLETED' AND a."dueDate" < ${now}
    ORDER BY a."dueDate" ASC, a."id" ASC
    LIMIT ${REPEAT_CAUSE_LIMITS.overdueItems}`;
}

/**
 * Pure half: one insight per recurring problem with at least one overdue follow-up. Critical when a
 * follow-up is high priority or a month late on a problem seen three or more times.
 */
export function deriveRepeatCauseInsights(input: RepeatCauseInput): OpsInsightItem[] {
  const items: Array<OpsInsightItem & { severity: OpsInsightSeverity }> = [];
  for (const problem of input.problems) {
    if (problem.occurrences < 2 || problem.overdue.length === 0) continue;
    const overdue = [...problem.overdue].sort(
      (a, b) => b.daysLate - a.daysLate || a.id.localeCompare(b.id)
    );
    const longest = overdue[0].daysLate;
    const serious = overdue.some(item => item.high) || longest >= 30;
    const late = plural(overdue.length, 'overdue action item');
    items.push({
      key: problem.key.slice(0, 200),
      severity: serious && problem.occurrences >= 3 ? 'CRITICAL' : 'WARNING',
      title: `Repeat problem, seen ${problem.occurrences} times, has ${late}`,
      summary: `A problem on this service came back ${problem.occurrences} times in ${input.windowDays} days (last on ${problem.lastSeenDay}) while ${plural(overdue.length, 'follow-up')} from an earlier postmortem ${overdue.length === 1 ? 'is' : 'are'} past due.`,
      evidence: {
        window: `last ${input.windowDays} days`,
        facts: [
          { label: 'Occurrences', value: String(problem.occurrences) },
          { label: 'Last seen', value: problem.lastSeenDay },
          { label: 'Overdue action items', value: String(overdue.length) },
          { label: 'Longest overdue', value: plural(longest, 'day') },
        ],
        examples: [
          ...overdue.slice(0, 3).map(item => ({
            label: `${item.high ? 'High-priority action item' : 'Action item'} due ${item.dueDay}`,
            href: `/postmortems/${item.incidentId}`,
          })),
          { label: 'Latest occurrence', href: `/incidents/${problem.latestIncidentId}` },
        ],
      },
      draftHref: `/postmortems/${overdue[0].incidentId}`,
    });
  }
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
  return items.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.key ?? '').localeCompare(b.key ?? '')
  );
}

export const repeatCauseProducer: OpsInsightProducer<RepeatCauseInput> = {
  kind: REPEAT_CAUSE_KIND,
  version: 1,
  area: 'postmortems',
  scopeType: 'SERVICE',

  async loadInput(scope, { tx, now }) {
    const problems = await tx.$queryRaw<ProblemRow[]>(repeatCauseProblemsSql(scope.id, now));
    if (problems.length === 0) return null;
    const items = await tx.$queryRaw<ItemRow[]>(
      repeatCauseOverdueSql(
        scope.id,
        problems.map(row => row.template),
        now
      )
    );
    return {
      windowDays: REPEAT_CAUSE_LIMITS.windowDays,
      problems: problems.map(row => ({
        key: row.key,
        occurrences: row.occurrences,
        lastSeenDay: day(row.lastSeen),
        latestIncidentId: row.latest,
        overdue: items
          .filter(item => item.template === row.template)
          .map(item => ({
            id: item.id,
            incidentId: item.incidentId,
            high: item.priority === 'HIGH',
            dueDay: day(item.dueDate),
            daysLate: Math.min(
              REPEAT_CAUSE_LIMITS.daysLate,
              Math.max(0, Math.floor((now.getTime() - item.dueDate.getTime()) / DAY_MS))
            ),
          })),
      })),
    };
  },

  derive: deriveRepeatCauseInsights,
};
