import type { OpsInsightItem } from '../ops-insights/contract';
import { wilsonLowerBound } from '../recommendations/wilson';
import { clusterNotes, type NoteRef } from './notes';

/**
 * Pure runbook-health logic: no database, no clock, no store. The runbook-health producer feeds it from the
 * daily runbook rollups in the lane; the runbook page feeds `summarizeRunbookEffectiveness` from the same
 * rollups on read. Stored insights carry only counts, step names (runbook content, readable by whoever may
 * read the runbook) and links holding incident and note ids; note text is resolved on read.
 */

export const RUNBOOK_HEALTH_LIMITS = {
  /** Outcomes older than this say little about the runbook as it is today. */
  windowDays: 90,
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

/** ops.runbook.run stores floor(4 * log2(seconds)); a bucket's midpoint stands for its runs. */
export const RUNBOOK_DURATION_BUCKETS_PER_DOUBLING = 4;

/** Outcomes of one runbook over the window. Eligible = SUCCEEDED + FAILED + TIMED_OUT. */
export interface RunbookRunStats {
  eligible: number;
  succeeded: number;
  /** Eligible runs that were started for an incident; only these can have fixed anything. */
  incidentRuns: number;
  /** Incident runs that succeeded and whose incident resolved inside the fix window. */
  fixed: number;
  /** Approximate (histogram midpoint, within about 10%); null when no run has a start time. */
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

/** One row of an operations rollup as queryOpsRollup returns it; only these fields are read. */
export interface RunbookRollupPoint {
  count: number;
  tags: unknown;
}

const tagsOf = (point: RunbookRollupPoint): Record<string, unknown> =>
  point.tags && typeof point.tags === 'object' && !Array.isArray(point.tags)
    ? (point.tags as Record<string, unknown>)
    : {};

/** Run outcomes from ops.runbook.run rows; `fixWindowMinutes` is applied here, so changing it needs no recompute. */
export function runStatsFromRollup(
  points: readonly RunbookRollupPoint[],
  fixWindowMinutes: number
): RunbookRunStats {
  const stats = { eligible: 0, succeeded: 0, incidentRuns: 0, fixed: 0 };
  const durations = new Map<number, number>();
  for (const point of points) {
    const tags = tagsOf(point);
    const count = Number(point.count) || 0;
    stats.eligible += count;
    if (tags.status === 'SUCCEEDED') stats.succeeded += count;
    if (tags.onIncident === true) stats.incidentRuns += count;
    if (typeof tags.fixMinutes === 'number' && tags.fixMinutes <= fixWindowMinutes)
      stats.fixed += count;
    if (typeof tags.durationBucket === 'number')
      durations.set(tags.durationBucket, (durations.get(tags.durationBucket) ?? 0) + count);
  }
  return { ...stats, medianDurationMs: medianFromBuckets(durations) };
}

function medianFromBuckets(buckets: ReadonlyMap<number, number>): number | null {
  const total = [...buckets.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  let seen = 0;
  for (const bucket of [...buckets.keys()].sort((a, b) => a - b)) {
    seen += buckets.get(bucket) ?? 0;
    if (seen * 2 >= total) {
      const seconds = 2 ** ((bucket + 0.5) / RUNBOOK_DURATION_BUCKETS_PER_DOUBLING);
      // Bucket 0 holds everything under 1.19 s, including sub-second runs.
      return Math.round((bucket === 0 ? 1 : seconds) * 1000);
    }
  }
  return null;
}

/** Per-step outcomes from ops.runbook.step_outcome rows, in first-seen order. */
export function stepStatsFromRollup(points: readonly RunbookRollupPoint[]): RunbookStepStats[] {
  const steps = new Map<
    string,
    { name: string; runs: number; failed: number; retried: number; errors: Map<string, number> }
  >();
  for (const point of points) {
    const tags = tagsOf(point);
    if (typeof tags.stepKey !== 'string') continue;
    const count = Number(point.count) || 0;
    let step = steps.get(tags.stepKey);
    if (!step) {
      step = { name: '', runs: 0, failed: 0, retried: 0, errors: new Map() };
      steps.set(tags.stepKey, step);
    }
    // The latest day's name wins: rows arrive oldest first.
    if (typeof tags.name === 'string' && tags.name) step.name = tags.name;
    step.runs += count;
    if (tags.status === 'FAILED') step.failed += count;
    if (tags.retried === true) step.retried += count;
    if (typeof tags.errorCode === 'string' && tags.errorCode)
      step.errors.set(tags.errorCode, (step.errors.get(tags.errorCode) ?? 0) + count);
  }
  return [...steps.entries()].map(([stepKey, step]) => {
    let topErrorCode: string | null = null;
    let topErrorCount = 0;
    for (const [code, count] of step.errors)
      if (
        count > topErrorCount ||
        (count === topErrorCount && topErrorCode && code < topErrorCode)
      ) {
        topErrorCode = code;
        topErrorCount = count;
      }
    return {
      stepKey,
      name: step.name || stepKey,
      runs: step.runs,
      failed: step.failed,
      retried: step.retried,
      topErrorCode,
      topErrorCount,
    };
  });
}

export interface RunbookEffectiveness {
  windowDays: number;
  fixWindowMinutes: number;
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

export function summarizeRunbookEffectiveness(input: {
  windowDays: number;
  fixWindowMinutes: number;
  runs: RunbookRunStats;
  steps: readonly RunbookStepStats[];
  lastRunAt: Date | null;
  lastEditedAt: Date | null;
}): RunbookEffectiveness {
  const { runs } = input;
  return {
    windowDays: input.windowDays,
    fixWindowMinutes: input.fixWindowMinutes,
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

/** A group of similar notes responders wrote after runs of the runbook. */
export interface FollowUpCluster {
  signature: string;
  runsWithNote: number;
  /** At most OPS_INSIGHT_LIMITS.examples; ids only. */
  refs: NoteRef[];
}

/**
 * The lane's summary of one runbook. Ages are whole days capped just past their threshold, so an unchanged
 * runbook hashes the same from one day to the next and the lane skips it.
 */
export interface RunbookHealthInput {
  runbookId: string;
  archived: boolean;
  /** Days since the published version was published, capped at unusedDays + 1; null while unpublished. */
  publishedDaysAgo: number | null;
  /** Days since the latest run of any status, capped at unusedDays + 1; null when it never ran. */
  lastRunDaysAgo: number | null;
  windowDays: number;
  eligible: number;
  succeeded: number;
  steps: RunbookStepStats[];
  /** Successful incident runs examined for follow-up notes. */
  followUpRuns: number;
  followUps: FollowUpCluster[];
}

const editorHref = (runbookId: string) => `/runbooks/${runbookId}?tab=builder`;

/** Notes are linked by id: the incident page shows the text to whoever may read that incident. */
export const noteRefHref = (ref: NoteRef) =>
  `/incidents/${ref.incidentId}#${ref.kind === 'event' ? 'event' : 'note'}-${ref.id}`;

/**
 * Insights for one runbook. Every threshold needs enough runs to be believed: a runbook that failed once
 * out of once says nothing, so "fails often" uses the lower bound of the failure rate, not the raw rate.
 */
export function runbookHealthInsights(input: RunbookHealthInput): OpsInsightItem[] {
  if (input.archived) return [];
  const L = RUNBOOK_HEALTH_LIMITS;
  const items: OpsInsightItem[] = [];
  const failed = input.eligible - input.succeeded;
  const window = `last ${input.windowDays} days`;

  if (input.eligible >= L.minRunsForFailure) {
    const bound = wilsonLowerBound(failed, input.eligible);
    if (bound >= L.failsOftenLowerBound) {
      items.push({
        key: 'fails-often',
        severity: bound >= L.failsCriticalLowerBound ? 'CRITICAL' : 'WARNING',
        title: `Failed ${failed} of ${input.eligible} runs`,
        summary: `At least ${percent(bound)} of this runbook's runs fail, allowing for how many runs there were. The step breakdown in Health shows where.`,
        evidence: {
          window,
          facts: [
            { label: 'Failed or timed out', value: String(failed) },
            { label: 'Finished runs', value: String(input.eligible) },
            { label: 'Failure rate', value: percent(failed / input.eligible) },
            { label: 'Failure rate is at least', value: percent(bound) },
          ],
        },
        draftHref: editorHref(input.runbookId),
      });
    }
  }

  if (
    input.publishedDaysAgo !== null &&
    input.publishedDaysAgo > L.unusedDays &&
    (input.lastRunDaysAgo === null || input.lastRunDaysAgo > L.unusedDays)
  ) {
    items.push({
      key: 'unused',
      severity: 'INFO',
      title:
        input.lastRunDaysAgo === null
          ? 'Never run since it was published'
          : `Not run in the last ${L.unusedDays} days`,
      summary:
        'Nobody has needed this runbook for a while. Check that it is still bound where it should be, or archive it.',
      evidence: {
        facts: [
          {
            label: 'Last run',
            value: input.lastRunDaysAgo === null ? 'Never' : `More than ${L.unusedDays} days ago`,
          },
          { label: 'Published', value: `More than ${L.unusedDays} days ago` },
        ],
      },
    });
  }

  for (const step of input.steps) {
    if (step.runs >= L.minStepRuns && step.failed / step.runs > L.stepFailureRate) {
      items.push({
        key: `step-failing:${step.stepKey}`,
        severity: 'WARNING',
        title: `Step "${step.name}" fails in ${percent(step.failed / step.runs)} of runs`.slice(
          0,
          140
        ),
        summary: step.topErrorCode
          ? `It failed ${step.failed} of ${step.runs} times, most often with ${step.topErrorCode}.`
          : `It failed ${step.failed} of ${step.runs} times.`,
        evidence: {
          window,
          facts: [
            { label: 'Step', value: step.name.slice(0, 160) },
            { label: 'Failed', value: `${step.failed} of ${step.runs} runs` },
            ...(step.topErrorCode
              ? [
                  {
                    label: 'Top error code',
                    value: `${step.topErrorCode.slice(0, 120)} (${step.topErrorCount})`,
                  },
                ]
              : []),
          ],
        },
        draftHref: editorHref(input.runbookId),
      });
    }
    if (step.runs >= L.minRetriedRuns && step.retried === step.runs) {
      items.push({
        key: `step-retried:${step.stepKey}`,
        severity: 'WARNING',
        title: `Step "${step.name}" needed a retry in all ${step.runs} runs`.slice(0, 140),
        summary:
          'It never works on the first attempt. Fix what it waits for, or give it a longer timeout.',
        evidence: {
          window,
          facts: [
            { label: 'Step', value: step.name.slice(0, 160) },
            { label: 'Retried', value: `${step.retried} of ${step.runs} runs` },
            ...(step.topErrorCode
              ? [{ label: 'Error before the retry', value: step.topErrorCode.slice(0, 160) }]
              : []),
          ],
        },
        draftHref: editorHref(input.runbookId),
      });
    }
  }

  for (const cluster of input.followUps) {
    items.push({
      key: `missing-step:${cluster.signature}`,
      severity: 'INFO',
      title: `Responders add the same note after ${cluster.runsWithNote} of ${input.followUpRuns} runs`,
      summary:
        'Something is still done by hand after this runbook succeeds. The suggested step is shown in Health to people who can read those incidents.',
      evidence: {
        facts: [
          { label: 'Runs followed by the note', value: String(cluster.runsWithNote) },
          { label: 'Successful incident runs examined', value: String(input.followUpRuns) },
        ],
        examples: cluster.refs.map((ref, index) => ({
          label: `Follow-up note ${index + 1}`,
          href: noteRefHref(ref),
        })),
      },
      draftHref: editorHref(input.runbookId),
    });
  }
  return items;
}

/** One successful run and the notes written on its incident within a day after it finished. */
export interface RunFollowUpNotes {
  executionId: string;
  notes: ReadonlyArray<NoteRef & { text: string }>;
}

/**
 * When responders write much the same note after most runs, the runbook is missing that step. A note
 * counts once per run however often it is repeated there. Text is used to group and then dropped: the
 * result holds ids and counts only.
 */
export function followUpClusters(
  runs: readonly RunFollowUpNotes[],
  maxRefs = 5
): FollowUpCluster[] {
  const L = RUNBOOK_HEALTH_LIMITS;
  if (runs.length < L.missingStepMinRuns) return [];
  const notes = runs.flatMap(run =>
    run.notes.map(note => ({ ...note, executionId: run.executionId }))
  );
  const clusters: FollowUpCluster[] = [];
  for (const cluster of clusterNotes(notes)) {
    const executionIds = new Set(cluster.members.map(member => member.executionId));
    if (
      executionIds.size < L.missingStepMinRuns ||
      executionIds.size / runs.length < L.missingStepShare
    )
      continue;
    clusters.push({
      signature: cluster.signature,
      runsWithNote: executionIds.size,
      refs: cluster.members
        .slice(0, maxRefs)
        .map(({ kind, id, incidentId }) => ({ kind, id, incidentId })),
    });
  }
  return clusters;
}
