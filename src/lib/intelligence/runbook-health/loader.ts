import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { createHash } from 'node:crypto';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { withDbBudget } from '../jobs/db-budget';
import { runbookFixedSql } from '../recommendations/ranker';
import { getIntelligenceSettings } from '../settings/service';
import {
  missingStepInsights,
  runbookHealthInsights,
  summarizeRunbookEffectiveness,
  RUNBOOK_HEALTH_LIMITS,
  type InsightItem,
  type RunbookEffectiveness,
  type RunbookHealthInput,
  type RunbookStepStats,
  type RunFollowUpNotes,
} from './insights';
import {
  missingRunbookInsights,
  type MissingRunbookEvidence,
  type ProblemNotes,
  type ResolutionNote,
} from './notes';

/**
 * Reads the plain rows the pure functions in ./insights and ./notes work on. Every query is bounded by a
 * LIMIT and served by an index; a daily rollup can later replace loadRunbookHealthInput without touching
 * the callers. Nothing here writes.
 */

const DAY_MS = 86_400_000;
/** Read-path ceiling: a slow health query fails the section, never the page. */
const READ_BUDGET = { maxDbMs: 2_000 };
const FOLLOW_UP_RUNS = 50;
const FOLLOW_UP_NOTES = 300;
/** A note written this long after a run is about something else. */
const FOLLOW_UP_WINDOW_MS = DAY_MS;
const PROBLEM_INCIDENTS = 300;
const RESOLVED_PREFIX = 'Resolved: ';

type Tx = Prisma.TransactionClient;

type RunRow = {
  eligible: number;
  succeeded: number;
  incidentRuns: number;
  fixed: number;
  medianDurationMs: number | null;
};
type StepRow = { stepKey: string; name: string; runs: number; failed: number; retried: number };
type ErrorRow = { stepKey: string; errorCode: string; count: number };

/** The most recent runs of one runbook inside the window; idx_runbook_execution_runbook_recent. */
const recentRuns = (runbookId: string, since: Date) => Prisma.sql`
  SELECT e."id", e."status", e."incidentId", e."startedAt", e."completedAt"
  FROM "RunbookExecution" e
  WHERE e."runbookId" = ${runbookId} AND e."createdAt" >= ${since}
    AND e."status" IN ('SUCCEEDED', 'FAILED', 'TIMED_OUT')
  ORDER BY e."createdAt" DESC
  LIMIT ${RUNBOOK_HEALTH_LIMITS.maxRuns}`;

export async function loadRunbookHealthInput(
  tx: Tx,
  runbookId: string,
  options: { now: Date; fixWindowMinutes: number }
): Promise<RunbookHealthInput | null> {
  const runbook = await tx.runbook.findUnique({
    where: { id: runbookId },
    select: {
      archivedAt: true,
      updatedAt: true,
      draftVersion: { select: { updatedAt: true } },
      publishedVersion: { select: { publishedAt: true } },
    },
  });
  if (!runbook) return null;
  const windowDays = RUNBOOK_HEALTH_LIMITS.windowDays;
  const since = new Date(options.now.getTime() - windowDays * DAY_MS);
  const recent = recentRuns(runbookId, since);

  const [run] = await tx.$queryRaw<RunRow[]>(Prisma.sql`
    WITH recent AS (${recent})
    SELECT count(*)::int AS eligible,
           count(*) FILTER (WHERE e."status" = 'SUCCEEDED')::int AS succeeded,
           count(*) FILTER (WHERE e."incidentId" IS NOT NULL)::int AS "incidentRuns",
           count(*) FILTER (WHERE ${runbookFixedSql(options.fixWindowMinutes)})::int AS fixed,
           (percentile_cont(0.5) WITHIN GROUP (
              ORDER BY extract(epoch FROM (e."completedAt" - e."startedAt")) * 1000
            ) FILTER (WHERE e."startedAt" IS NOT NULL AND e."completedAt" IS NOT NULL))::float8
             AS "medianDurationMs"
    FROM recent e
    LEFT JOIN "Incident" i ON i."id" = e."incidentId"`);

  const stepRows = await tx.$queryRaw<StepRow[]>(Prisma.sql`
    WITH recent AS (${recent})
    SELECT s."stepKey",
           max(s."name") AS name,
           count(*)::int AS runs,
           count(*) FILTER (WHERE s."status" = 'FAILED')::int AS failed,
           count(*) FILTER (WHERE s."attemptCount" > 1)::int AS retried
    FROM recent e
    JOIN "RunbookExecutionStep" s ON s."executionId" = e."id"
    WHERE s."status" IN ('SUCCEEDED', 'FAILED')
    GROUP BY s."stepKey"`);

  // Failed attempts carry the error even when a later retry succeeded; steps that never reached an
  // agent have no attempt, so their own error code stands in.
  const errorRows = await tx.$queryRaw<ErrorRow[]>(Prisma.sql`
    WITH recent AS (${recent}),
    errors AS (
      SELECT s."stepKey", a."errorCode"
      FROM recent e
      JOIN "RunbookExecutionStep" s ON s."executionId" = e."id"
      JOIN "RunbookStepAttempt" a ON a."executionStepId" = s."id"
      WHERE a."status" IN ('FAILED', 'TIMED_OUT') AND a."errorCode" IS NOT NULL
      UNION ALL
      SELECT s."stepKey", s."errorCode"
      FROM recent e
      JOIN "RunbookExecutionStep" s ON s."executionId" = e."id"
      WHERE s."status" = 'FAILED' AND s."attemptCount" = 0 AND s."errorCode" IS NOT NULL
    )
    SELECT "stepKey", "errorCode", count(*)::int AS count
    FROM errors
    GROUP BY "stepKey", "errorCode"
    ORDER BY count DESC, "errorCode"
    LIMIT 500`);

  const lastRun = await tx.runbookExecution.findFirst({
    where: { runbookId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  // Rows arrive most frequent first, so the first code seen for a step is its top one.
  const topError = new Map<string, ErrorRow>();
  for (const row of errorRows) if (!topError.has(row.stepKey)) topError.set(row.stepKey, row);
  const steps: RunbookStepStats[] = stepRows.map(row => ({
    ...row,
    topErrorCode: topError.get(row.stepKey)?.errorCode ?? null,
    topErrorCount: topError.get(row.stepKey)?.count ?? 0,
  }));

  const edits = [
    runbook.updatedAt,
    runbook.draftVersion?.updatedAt,
    runbook.publishedVersion?.publishedAt,
  ].filter((value): value is Date => value instanceof Date);

  return {
    runbookId,
    publishedAt: runbook.publishedVersion?.publishedAt ?? null,
    archived: Boolean(runbook.archivedAt),
    lastEditedAt: edits.length ? new Date(Math.max(...edits.map(date => date.getTime()))) : null,
    lastRunAt: lastRun?.createdAt ?? null,
    windowDays,
    runs: run ?? { eligible: 0, succeeded: 0, incidentRuns: 0, fixed: 0, medianDurationMs: null },
    steps,
  };
}

/**
 * Notes responders wrote on the incident within a day after each recent successful run. Only incidents
 * the viewer may read contribute, because the note text is shown as evidence.
 */
export async function loadRunFollowUpNotes(
  tx: Tx,
  runbookId: string,
  options: { now: Date; incidentWhere: Prisma.IncidentWhereInput }
): Promise<RunFollowUpNotes[]> {
  const since = new Date(options.now.getTime() - RUNBOOK_HEALTH_LIMITS.windowDays * DAY_MS);
  const runs = await tx.runbookExecution.findMany({
    where: {
      runbookId,
      createdAt: { gte: since },
      status: 'SUCCEEDED',
      completedAt: { not: null },
      incidentId: { not: null },
      incident: { is: options.incidentWhere },
    },
    orderBy: { createdAt: 'desc' },
    take: FOLLOW_UP_RUNS,
    select: { id: true, incidentId: true, completedAt: true },
  });
  if (runs.length === 0) return [];
  const notes = await tx.incidentNote.findMany({
    where: {
      incidentId: { in: runs.map(run => run.incidentId as string) },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: FOLLOW_UP_NOTES,
    select: { incidentId: true, content: true, createdAt: true },
  });
  return runs.map(run => {
    const from = (run.completedAt as Date).getTime();
    return {
      executionId: run.id,
      notes: notes
        .filter(
          note =>
            note.incidentId === run.incidentId &&
            note.createdAt.getTime() >= from &&
            note.createdAt.getTime() <= from + FOLLOW_UP_WINDOW_MS
        )
        .map(note => note.content),
    };
  });
}

/**
 * Hand-written resolution notes of a service's recently resolved incidents, grouped by problem template.
 * Three bounded reads: idx_incident_fingerprint_service_recent, idx_event_type, RunbookExecution(incidentId).
 */
export async function loadProblemNotes(
  tx: Tx,
  serviceId: string,
  options: { now: Date; incidentWhere: Prisma.IncidentWhereInput }
): Promise<ProblemNotes[]> {
  const since = new Date(options.now.getTime() - RUNBOOK_HEALTH_LIMITS.windowDays * DAY_MS);
  const fingerprints = await tx.incidentFingerprint.findMany({
    where: {
      serviceId,
      incidentCreatedAt: { gte: since },
      resolvedAt: { not: null },
      incident: { is: options.incidentWhere },
    },
    orderBy: { incidentCreatedAt: 'desc' },
    take: PROBLEM_INCIDENTS,
    select: { incidentId: true, template: true, templateHash: true },
  });
  if (fingerprints.length === 0) return [];
  const incidentIds = fingerprints.map(row => row.incidentId);
  const events = await tx.incidentEvent.findMany({
    where: {
      incidentId: { in: incidentIds },
      type: 'MANUAL_RESOLVED',
      message: { startsWith: RESOLVED_PREFIX },
    },
    orderBy: { createdAt: 'desc' },
    take: PROBLEM_INCIDENTS * 2,
    select: { incidentId: true, message: true },
  });
  const ran = await tx.runbookExecution.groupBy({
    by: ['incidentId'],
    where: { incidentId: { in: incidentIds } },
    _count: { _all: true },
  });
  const runsByIncident = new Map(ran.map(row => [row.incidentId, row._count._all]));
  // Newest first: a reopened incident keeps only its latest resolution note.
  const noteByIncident = new Map<string, string>();
  for (const event of events)
    if (!noteByIncident.has(event.incidentId))
      noteByIncident.set(event.incidentId, event.message.slice(RESOLVED_PREFIX.length));

  const problems = new Map<
    string,
    { templateHash: string; template: string; notes: ResolutionNote[]; runbookRuns: number }
  >();
  for (const row of fingerprints) {
    if (!row.template) continue;
    let problem = problems.get(row.template);
    if (!problem) {
      problem = {
        templateHash:
          row.templateHash ?? createHash('sha256').update(row.template).digest('hex').slice(0, 32),
        template: row.template,
        notes: [],
        runbookRuns: 0,
      };
      problems.set(row.template, problem);
    }
    problem.runbookRuns += runsByIncident.get(row.incidentId) ?? 0;
    const text = noteByIncident.get(row.incidentId);
    if (text) problem.notes.push({ incidentId: row.incidentId, text });
  }
  return [...problems.values()];
}

export interface RunbookHealthView {
  effectiveness: RunbookEffectiveness;
  insights: InsightItem[];
}

/** The Health section of one runbook; null when the area is switched off or the runbook is gone. */
export async function getRunbookHealthView(
  runbookId: string,
  actor: AuthorizationActor,
  now: Date = new Date()
): Promise<RunbookHealthView | null> {
  const settings = await getIntelligenceSettings();
  if (!settings.runbookInsightsEnabled) return null;
  const incidentWhere = incidentReadWhere(actor);
  return withDbBudget(READ_BUDGET, async tx => {
    const input = await loadRunbookHealthInput(tx, runbookId, {
      now,
      fixWindowMinutes: settings.runbookFixWindowMinutes,
    });
    if (!input) return null;
    const followUps = input.archived
      ? []
      : await loadRunFollowUpNotes(tx, runbookId, { now, incidentWhere });
    return {
      effectiveness: summarizeRunbookEffectiveness(input),
      insights: [...runbookHealthInsights(input, now), ...missingStepInsights(followUps)],
    };
  });
}

export type MissingRunbookSuggestion = InsightItem & { evidence: MissingRunbookEvidence };

/** "Write a runbook for this" suggestions for one service; empty when the area is switched off. */
export async function getMissingRunbookSuggestions(
  serviceId: string,
  actor: AuthorizationActor,
  now: Date = new Date()
): Promise<MissingRunbookSuggestion[]> {
  const settings = await getIntelligenceSettings();
  if (!settings.runbookInsightsEnabled) return [];
  const incidentWhere = incidentReadWhere(actor);
  return withDbBudget(READ_BUDGET, async tx => {
    const problems = await loadProblemNotes(tx, serviceId, { now, incidentWhere });
    if (problems.length === 0) return [];
    const boundRunbooks = await tx.serviceAutomationRule.count({
      where: { serviceId, enabled: true, detachedAt: null },
    });
    return missingRunbookInsights(problems, { boundRunbooks });
  });
}
