import { wilsonLowerBound } from '../recommendations/wilson';
import { clusterNotes } from './notes';
import type { InsightItem } from './types';

export type { InsightItem, InsightSeverity } from './types';

/**
 * Pure runbook-health logic: no database, no clock, no store. The loader (./loader.ts) supplies the plain
 * rows today; a daily rollup can supply the same shapes later without touching anything in this file.
 */

export const RUNBOOK_HEALTH_LIMITS = {
  /** Outcomes older than this say little about the runbook as it is today. */
  windowDays: 90,
  /** Most recent runs examined per runbook. */
  maxRuns: 500,
  unusedDays: 90,
  minRunsForFailure: 5,
  failsOftenLowerBound: 0.25,
  failsCriticalLowerBound: 0.5,
  minStepRuns: 5,
  stepFailureRate: 0.3,
  minRetriedRuns: 3,
  missingStepMinRuns: 3,
  missingStepShare: 0.6,
} as const;

/** Outcomes of one runbook over the window. Eligible = SUCCEEDED + FAILED + TIMED_OUT. */
export interface RunbookRunStats {
  eligible: number;
  succeeded: number;
  /** Eligible runs that were started for an incident; only these can have fixed anything. */
  incidentRuns: number;
  /** Incident runs that succeeded and whose incident resolved inside the fix window. */
  fixed: number;
  medianDurationMs: number | null;
}

export interface RunbookStepStats {
  stepKey: string;
  name: string;
  /** Runs in which the step reached SUCCEEDED or FAILED. */
  runs: number;
  failed: number;
  /** Runs in which the step took more than one attempt. */
  retried: number;
  topErrorCode: string | null;
  topErrorCount: number;
}

export interface RunbookHealthInput {
  runbookId: string;
  /** Null while the runbook has never been published: an unpublished runbook cannot be "unused". */
  publishedAt: Date | null;
  archived: boolean;
  lastEditedAt: Date | null;
  /** Latest run of any status, not limited to the window. */
  lastRunAt: Date | null;
  windowDays: number;
  runs: RunbookRunStats;
  steps: readonly RunbookStepStats[];
}

export interface RunbookEffectiveness {
  runbookId: string;
  windowDays: number;
  eligible: number;
  succeeded: number;
  successRate: number | null;
  /** 95% Wilson lower bound: what the success rate is at least, given how few runs there may be. */
  successLowerBound: number | null;
  incidentRuns: number;
  fixed: number;
  fixedRate: number | null;
  fixedLowerBound: number | null;
  medianDurationMs: number | null;
  mostFailingStep: (RunbookStepStats & { failureRate: number }) | null;
  lastRunAt: Date | null;
  lastEditedAt: Date | null;
}

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The step with the highest confident failure rate; ties go to the step that failed more often. */
function mostFailing(steps: readonly RunbookStepStats[]) {
  let best: (RunbookStepStats & { failureRate: number }) | null = null;
  let bestBound = 0;
  for (const step of steps) {
    if (step.failed <= 0 || step.runs <= 0) continue;
    const bound = wilsonLowerBound(step.failed, step.runs);
    if (!best || bound > bestBound || (bound === bestBound && step.failed > best.failed)) {
      best = { ...step, failureRate: step.failed / step.runs };
      bestBound = bound;
    }
  }
  return best;
}

export function summarizeRunbookEffectiveness(input: RunbookHealthInput): RunbookEffectiveness {
  const { runs } = input;
  return {
    runbookId: input.runbookId,
    windowDays: input.windowDays,
    eligible: runs.eligible,
    succeeded: runs.succeeded,
    successRate: rate(runs.succeeded, runs.eligible),
    successLowerBound: runs.eligible > 0 ? wilsonLowerBound(runs.succeeded, runs.eligible) : null,
    incidentRuns: runs.incidentRuns,
    fixed: runs.fixed,
    fixedRate: rate(runs.fixed, runs.incidentRuns),
    fixedLowerBound: runs.incidentRuns > 0 ? wilsonLowerBound(runs.fixed, runs.incidentRuns) : null,
    medianDurationMs: runs.medianDurationMs,
    mostFailingStep: mostFailing(input.steps),
    lastRunAt: input.lastRunAt,
    lastEditedAt: input.lastEditedAt,
  };
}

const DAY_MS = 86_400_000;

/**
 * Insights for one runbook. Every threshold needs enough runs to be believed: a runbook that failed once
 * out of once says nothing, so "fails often" uses the lower bound of the failure rate, not the raw rate.
 */
export function runbookHealthInsights(input: RunbookHealthInput, now: Date): InsightItem[] {
  if (input.archived) return [];
  const L = RUNBOOK_HEALTH_LIMITS;
  const items: InsightItem[] = [];
  const { runs } = input;
  const failed = runs.eligible - runs.succeeded;

  if (runs.eligible >= L.minRunsForFailure) {
    const bound = wilsonLowerBound(failed, runs.eligible);
    if (bound >= L.failsOftenLowerBound) {
      items.push({
        key: 'fails-often',
        kind: 'RUNBOOK_FAILS_OFTEN',
        severity: bound >= L.failsCriticalLowerBound ? 'critical' : 'warning',
        title: `Failed ${failed} of ${runs.eligible} runs in the last ${input.windowDays} days`,
        evidence: {
          failed,
          eligible: runs.eligible,
          failureRate: failed / runs.eligible,
          failureLowerBound: bound,
          windowDays: input.windowDays,
        },
      });
    }
  }

  const unusedSince = now.getTime() - L.unusedDays * DAY_MS;
  if (
    input.publishedAt &&
    input.publishedAt.getTime() <= unusedSince &&
    (!input.lastRunAt || input.lastRunAt.getTime() <= unusedSince)
  ) {
    items.push({
      key: 'unused',
      kind: 'RUNBOOK_UNUSED',
      severity: 'info',
      title: input.lastRunAt
        ? `Not run in the last ${L.unusedDays} days`
        : `Never run since it was published`,
      evidence: {
        lastRunAt: input.lastRunAt?.toISOString() ?? null,
        publishedAt: input.publishedAt.toISOString(),
        unusedDays: L.unusedDays,
      },
    });
  }

  for (const step of input.steps) {
    if (step.runs >= L.minStepRuns && step.failed / step.runs > L.stepFailureRate) {
      items.push({
        key: `step-failing:${step.stepKey}`,
        kind: 'RUNBOOK_STEP_FAILING',
        severity: 'warning',
        title: `Step "${step.name}" fails in ${percent(step.failed / step.runs)} of runs${
          step.topErrorCode ? ` (mostly ${step.topErrorCode})` : ''
        }`,
        evidence: {
          stepKey: step.stepKey,
          stepName: step.name,
          failed: step.failed,
          runs: step.runs,
          failureRate: step.failed / step.runs,
          topErrorCode: step.topErrorCode,
          topErrorCount: step.topErrorCount,
        },
      });
    }
    if (step.runs >= L.minRetriedRuns && step.retried === step.runs) {
      items.push({
        key: `step-retried:${step.stepKey}`,
        kind: 'RUNBOOK_STEP_ALWAYS_RETRIED',
        severity: 'warning',
        title: `Step "${step.name}" needed a retry in all ${step.runs} runs`,
        evidence: {
          stepKey: step.stepKey,
          stepName: step.name,
          retried: step.retried,
          runs: step.runs,
          topErrorCode: step.topErrorCode,
        },
      });
    }
  }
  return items;
}

/** One run of the runbook and the notes responders wrote on its incident after the run finished. */
export interface RunFollowUpNotes {
  executionId: string;
  notes: readonly string[];
}

/**
 * When responders write much the same note after most runs, the runbook is missing that step. A note
 * counts once per run however often it is repeated there.
 */
export function missingStepInsights(runs: readonly RunFollowUpNotes[]): InsightItem[] {
  const L = RUNBOOK_HEALTH_LIMITS;
  if (runs.length < L.missingStepMinRuns) return [];
  const notes = runs.flatMap(run =>
    run.notes.map(text => ({ text, executionId: run.executionId }))
  );
  const items: InsightItem[] = [];
  for (const cluster of clusterNotes(notes)) {
    const executionIds = [...new Set(cluster.members.map(member => member.executionId))];
    if (
      executionIds.length < L.missingStepMinRuns ||
      executionIds.length / runs.length < L.missingStepShare
    )
      continue;
    const note = cluster.members[0].text.trim().replace(/\s+/g, ' ').slice(0, 200);
    items.push({
      key: `missing-step:${cluster.signature}`,
      kind: 'RUNBOOK_MISSING_STEP',
      severity: 'info',
      title: `Responders add "${note}" after ${executionIds.length} of ${runs.length} runs`,
      evidence: {
        note,
        runsWithNote: executionIds.length,
        runs: runs.length,
        executionIds: executionIds.slice(0, 5),
      },
    });
  }
  return items;
}
