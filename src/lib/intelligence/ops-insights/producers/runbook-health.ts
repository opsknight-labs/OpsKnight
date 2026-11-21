import 'server-only';
import { OPS_ROLLUPS, queryOpsRollup } from '@/lib/metric-rollup';
import { OPS_INSIGHT_LIMITS } from '../contract';
import type { OpsInsightProducer } from '../producer';
import {
  followUpClusters,
  runbookHealthInsights,
  runStatsFromRollup,
  stepStatsFromRollup,
  RUNBOOK_HEALTH_LIMITS,
  type RunbookHealthInput,
} from '../../runbook-health/insights';

const DAY_MS = 86_400_000;
/** Successful incident runs examined for follow-up notes, newest first. */
export const FOLLOW_UP_RUNS = 50;
const FOLLOW_UP_NOTES = 300;
/** A note written this long after a run is about something else. */
const FOLLOW_UP_WINDOW_MS = DAY_MS;

const daysAgo = (now: Date, at: Date | null | undefined) =>
  at
    ? Math.min(
        RUNBOOK_HEALTH_LIMITS.unusedDays + 1,
        Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY_MS))
      )
    : null;

/**
 * Runbook health (plan J5), scope RUNBOOK: fails often, unused for 90 days, a step failing in more than 30%
 * of runs, a step that always needs a retry, and a note responders keep adding after successful runs.
 *
 * Reads, a fixed number of statements: the runbook by primary key, its latest run on
 * idx_runbook_execution_runbook_recent, 90 days of the ops.runbook.run and ops.runbook.step_outcome
 * rollups on idx_metric_rollup_subject, and for follow-ups the latest 50 successful incident runs (same
 * index) plus their incidents' notes on IncidentNote ("incidentId", "createdAt"). Raw run history is never
 * scanned.
 */
export const runbookHealthProducer: OpsInsightProducer<RunbookHealthInput> = {
  kind: 'runbook.health',
  version: 1,
  area: 'runbooks',
  scopeType: 'RUNBOOK',

  async loadInput(scope, { tx, now }) {
    const runbook = await tx.runbook.findUnique({
      where: { id: scope.id },
      select: { archivedAt: true, publishedVersion: { select: { publishedAt: true } } },
    });
    if (!runbook) return null;
    const windowDays = RUNBOOK_HEALTH_LIMITS.windowDays;
    const range = {
      from: new Date(now.getTime() - windowDays * DAY_MS),
      to: now,
      subjectKey: scope.id,
    };
    // One transaction runs one statement at a time: sequential awaits, not Promise.all.
    const lastRun = await tx.runbookExecution.findFirst({
      where: { runbookId: scope.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const runPoints = await queryOpsRollup(OPS_ROLLUPS.runbookRun, range, tx);
    const stepPoints = await queryOpsRollup(OPS_ROLLUPS.runbookStepOutcome, range, tx);
    const recent = await tx.runbookExecution.findMany({
      where: {
        runbookId: scope.id,
        createdAt: { gte: range.from },
        status: 'SUCCEEDED',
        incidentId: { not: null },
        completedAt: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: FOLLOW_UP_RUNS,
      select: { id: true, incidentId: true, completedAt: true },
    });
    const notes = recent.length
      ? await tx.incidentNote.findMany({
          where: {
            incidentId: { in: [...new Set(recent.map(run => run.incidentId as string))] },
            createdAt: { gte: range.from },
          },
          orderBy: { createdAt: 'desc' },
          take: FOLLOW_UP_NOTES,
          select: { id: true, incidentId: true, content: true, createdAt: true },
        })
      : [];
    // Success counts only: no insight depends on the fix window, so it stays out of the input hash.
    const runs = runStatsFromRollup(runPoints, 0);
    return {
      runbookId: scope.id,
      archived: Boolean(runbook.archivedAt),
      publishedDaysAgo: daysAgo(now, runbook.publishedVersion?.publishedAt),
      lastRunDaysAgo: daysAgo(now, lastRun?.createdAt),
      windowDays,
      eligible: runs.eligible,
      succeeded: runs.succeeded,
      steps: stepStatsFromRollup(stepPoints),
      followUpRuns: recent.length,
      followUps: followUpClusters(
        recent.map(run => {
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
              .map(note => ({
                kind: 'note' as const,
                id: note.id,
                incidentId: note.incidentId,
                text: note.content,
              })),
          };
        }),
        OPS_INSIGHT_LIMITS.examples
      ),
    };
  },

  derive: runbookHealthInsights,
};
