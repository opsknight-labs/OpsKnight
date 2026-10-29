import 'server-only';
import { Prisma } from '@prisma/client';
import { RESPONSE_LIMITS } from '../contract';
import type { FindingRow } from '../similarity/findings';
import { rankRunbooks, type RunbookOutcomeCounts } from './wilson';

const DAY_MS = 86_400_000;
const MAX_BOUND_RUNBOOKS = 50;
/** A run counts as having fixed its incident when the incident resolved within this long after it finished. */
const RESOLVED_WITHIN_MINUTES = 120;

/** Resolution must follow the start of the run; an already-resolved incident is not a successful fix. */
const fixed = Prisma.sql`e."status" = 'SUCCEEDED' AND i."status" = 'RESOLVED'
  AND e."startedAt" IS NOT NULL AND e."completedAt" IS NOT NULL
  AND i."resolvedAt" >= e."startedAt"
  AND i."resolvedAt" <= e."completedAt" + make_interval(mins => ${RESOLVED_WITHIN_MINUTES}::int)`;

type HistoryRow = {
  runbookId: string;
  eligible: number;
  succeeded: number;
  sameEligible: number;
  sameSucceeded: number;
};

/**
 * Ranks runbooks for an incident's service by how reliably they have fixed things here. A run counts as a
 * success only when it completed successfully and the incident it ran against was
 * resolved within RESOLVED_WITHIN_MINUTES afterwards: a script that "succeeds" without fixing anything is not
 * evidence. Runs on incidents with the same masked title as this one form a separate record, so a runbook
 * that fixed this exact problem before ranks first. Candidates are the runbooks bound to the service plus any
 * run against it; only published, non-archived runbooks are recommended. Nothing is ever executed from here.
 */
export async function computeRunbookFindings(
  tx: Prisma.TransactionClient,
  incident: { id?: string; serviceId: string },
  now: Date = new Date()
): Promise<FindingRow[]> {
  const since = new Date(now.getTime() - RESPONSE_LIMITS.runbookHistoryDays * DAY_MS);
  const template = incident.id
    ? ((
        await tx.incidentFingerprint.findUnique({
          where: { incidentId: incident.id },
          select: { template: true },
        })
      )?.template ?? '')
    : '';
  const [bindings, history] = await Promise.all([
    tx.serviceAutomationRule.findMany({
      where: { serviceId: incident.serviceId, enabled: true, detachedAt: null },
      take: MAX_BOUND_RUNBOOKS,
      select: { runbookId: true },
    }),
    tx.$queryRaw<HistoryRow[]>(Prisma.sql`
      SELECT e."runbookId",
             count(*)::int AS eligible,
             count(*) FILTER (WHERE ${fixed})::int AS succeeded,
             count(*) FILTER (WHERE f."template" = ${template} AND ${template} <> '')::int AS "sameEligible",
             count(*) FILTER (WHERE f."template" = ${template} AND ${template} <> '' AND ${fixed})::int AS "sameSucceeded"
      FROM "RunbookExecution" e
      LEFT JOIN "Incident" i ON i."id" = e."incidentId"
      LEFT JOIN "IncidentFingerprint" f ON f."incidentId" = e."incidentId"
      WHERE e."serviceId" = ${incident.serviceId} AND e."createdAt" >= ${since}
        AND e."status" IN ('SUCCEEDED', 'FAILED', 'TIMED_OUT')
      GROUP BY e."runbookId"`),
  ]);

  const counts = new Map<string, RunbookOutcomeCounts>();
  const entry = (runbookId: string) => {
    let existing = counts.get(runbookId);
    if (!existing) {
      existing = { runbookId, succeeded: 0, eligible: 0, bound: false };
      counts.set(runbookId, existing);
    }
    return existing;
  };
  for (const binding of bindings) entry(binding.runbookId).bound = true;
  for (const row of history) {
    const target = entry(row.runbookId);
    target.eligible = row.eligible;
    target.succeeded = row.succeeded;
    if (row.sameEligible > 0)
      target.sameProblem = { succeeded: row.sameSucceeded, eligible: row.sameEligible };
  }
  if (counts.size === 0) return [];

  const usable = await tx.runbook.findMany({
    where: { id: { in: [...counts.keys()] }, archivedAt: null, publishedVersionId: { not: null } },
    select: { id: true },
  });
  const usableIds = new Set(usable.map(runbook => runbook.id));
  const ranked = rankRunbooks(
    [...counts.values()].filter(
      candidate =>
        usableIds.has(candidate.runbookId) && (candidate.bound || candidate.succeeded > 0)
    ),
    RESPONSE_LIMITS.maxRunbookFindings
  );
  return ranked.map(candidate => ({
    confidence: candidate.confidence,
    subjectRef: candidate.runbookId,
    evidence: {
      type: 'runbook_history',
      calibrated: false,
      succeeded: candidate.succeeded,
      eligible: candidate.eligible,
      bound: candidate.bound,
      ...(candidate.sameProblem ? { sameProblem: { ...candidate.sameProblem } } : {}),
      windowDays: RESPONSE_LIMITS.runbookHistoryDays,
    },
  }));
}
