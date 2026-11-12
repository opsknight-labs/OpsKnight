import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { CONNECTOR_ADAPTERS } from '../connectors/adapters';
import type { MetricsQuery, ResolvedConnection } from '../connectors/adapters/types';
import { ConnectorError, type ConnectorFetch } from '../connectors/http';
import type { RawSeries, TimeWindow } from '../connectors/normalize';
import { contextFor, loadConnectionForLane } from '../connectors/service';
import { reanalyzeAfterLateChange } from '../changes/service';
import { withDbBudget } from '../jobs/db-budget';
import type { ClaimedWorkItem } from '../jobs/work-queue';
import {
  METRIC_EVALUATION_CONCURRENCY,
  METRIC_EVALUATION_STATUS,
  METRIC_EVIDENCE_GRACE_MINUTES,
  METRIC_FETCH_CONCURRENCY,
  METRIC_TEMPLATE_BOUNDS,
  type MetricDirection,
} from './contract';
import {
  DETECTOR_DEFAULTS,
  detectDeviations,
  judgeSamples,
  WEEK_MS,
  type Deviation,
  type HistoryWeek,
  type SamplePoint,
} from './detector';
import { connectionScopeProblem } from './service';

/**
 * The lane job behind EVALUATE_METRIC_TEMPLATE. It reads one template, queries the current window and the
 * same window in each of the last N weeks through the template's observability connection, and records the
 * deviations it finds as MetricAnomaly rows. Never on the paging path; every statement is budgeted; the
 * network calls run outside any transaction, bounded in number, concurrency and time (the connection's own
 * timeout and the lane's abort signal). A connector that fails or times out yields no evidence: the status is
 * recorded on the template and the work item completes, so a broken endpoint is never retried in a loop.
 * Results are fenced on the work generation, so an older run can never overwrite a newer one.
 */

export type MetricSeriesFetcher = (
  connection: ResolvedConnection,
  query: MetricsQuery,
  signal: AbortSignal
) => Promise<RawSeries[]>;

export interface EvaluationDependencies {
  /** Replaces the network transport of the real adapter (tests). */
  fetch?: ConnectorFetch;
  /** Replaces the adapter altogether (tests). */
  fetchSeries?: MetricSeriesFetcher;
  now?: () => Date;
}

export interface EvaluationResult {
  outcome: 'evaluated' | 'skipped' | 'degraded' | 'stale' | 'gone';
  status: string | null;
  anomalies: number;
  created: number;
}

/* ---------------------------------------------------------------------------------- bounded concurrency */

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const index = this.waiting.indexOf(grant);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new ConnectorError('ABORTED', 'The evaluation was cancelled'));
        };
        const grant = () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        this.waiting.push(grant);
      });
    } else this.active += 1;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

/** Evaluations in flight in this process; the lane's own concurrency bounds the rest. */
const evaluations = new Semaphore(METRIC_EVALUATION_CONCURRENCY);

async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        // eslint-disable-next-line security/detect-object-injection -- index within the array bounds
        results[index] = await work(items[index]);
      }
    })
  );
  return results;
}

/* --------------------------------------------------------------------------------------------- series */

/** A stable key for a series' labels, so the current window is compared with the same series last week. */
export function seriesKeyOf(labels: Record<string, unknown>): string {
  const canonical = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 24);
}

function compactLabels(labels: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .slice(0, 6)
      .map(([key, value]) => [key.slice(0, 60), String(value).slice(0, 80)])
  );
}

function boundSeries(raw: readonly RawSeries[]) {
  return raw.slice(0, METRIC_TEMPLATE_BOUNDS.maxSeries).map(series => ({
    key: seriesKeyOf(series.labels),
    labels: compactLabels(series.labels),
    points: series.points.slice(0, METRIC_TEMPLATE_BOUNDS.maxPointsPerSeries) as SamplePoint[],
  }));
}

/** Current window aligned to the step, and the same window N weeks back, padded for the neighbourhood. */
export function evaluationWindows(
  now: Date,
  template: { windowMinutes: number; stepSeconds: number; baselineWeeks: number }
): { current: TimeWindow; history: Array<{ weeksAgo: number; window: TimeWindow }> } {
  const stepMs = template.stepSeconds * 1000;
  const end = Math.floor(now.getTime() / stepMs) * stepMs;
  const start = end - template.windowMinutes * 60_000;
  const pad = stepMs * (DETECTOR_DEFAULTS.neighbourhood + 1);
  return {
    current: { start: new Date(start), end: new Date(end) },
    history: Array.from({ length: template.baselineWeeks }, (_, index) => {
      const weeksAgo = index + 1;
      return {
        weeksAgo,
        window: {
          start: new Date(start - weeksAgo * WEEK_MS - pad),
          end: new Date(end - weeksAgo * WEEK_MS + pad),
        },
      };
    }),
  };
}

const defaultFetcher =
  (fetch: ConnectorFetch | undefined): MetricSeriesFetcher =>
  async (connection, query, signal) => {
    const adapter = CONNECTOR_ADAPTERS[connection.kind];
    if (!adapter?.series)
      throw new ConnectorError('UNSUPPORTED', 'This connection cannot answer metric queries');
    return adapter.series(contextFor(connection, { fetch, signal }), query);
  };

/* ------------------------------------------------------------------------------------------ evaluation */

type TemplateRow = {
  id: string;
  serviceId: string;
  connectionId: string | null;
  query: string;
  enabled: boolean;
  direction: string;
  thresholdMad: number;
  baselineWeeks: number;
  windowMinutes: number;
  stepSeconds: number;
  minDeviation: number;
  lastGeneration: number;
  service: { teamId: string | null };
};

interface Detected extends Deviation {
  seriesKey: string;
  labels: Record<string, string>;
}

export async function evaluateMetricTemplate(
  item: Pick<ClaimedWorkItem, 'subjectKey' | 'generation'>,
  settings: { maxDbMs: number },
  signal: AbortSignal,
  dependencies: EvaluationDependencies = {}
): Promise<EvaluationResult> {
  return evaluations.run(signal, () => evaluate(item, settings, signal, dependencies));
}

async function evaluate(
  item: Pick<ClaimedWorkItem, 'subjectKey' | 'generation'>,
  settings: { maxDbMs: number },
  signal: AbortSignal,
  dependencies: EvaluationDependencies
): Promise<EvaluationResult> {
  const now = dependencies.now?.() ?? new Date();
  const loaded = await withDbBudget(settings, async tx => {
    const template = (await tx.serviceMetricTemplate.findUnique({
      where: { id: item.subjectKey },
      select: {
        id: true,
        serviceId: true,
        connectionId: true,
        query: true,
        enabled: true,
        direction: true,
        thresholdMad: true,
        baselineWeeks: true,
        windowMinutes: true,
        stepSeconds: true,
        minDeviation: true,
        lastGeneration: true,
        service: { select: { teamId: true } },
      },
    })) as TemplateRow | null;
    if (!template || !template.enabled || template.lastGeneration > item.generation)
      return { template, lane: null };
    const lane = template.connectionId
      ? await loadConnectionForLane(template.connectionId, tx)
      : null;
    return { template, lane };
  });
  const template = loaded.template;
  if (!template) return { outcome: 'gone', status: null, anomalies: 0, created: 0 };
  if (template.lastGeneration > item.generation)
    return { outcome: 'stale', status: null, anomalies: 0, created: 0 };
  // Disabled since it was scheduled: nothing to do and nothing to record.
  if (!template.enabled) return { outcome: 'skipped', status: null, anomalies: 0, created: 0 };

  const problem = connectionScopeProblem(
    loaded.lane
      ? {
          enabled: loaded.lane.enabled,
          kind: loaded.lane.connection.kind,
          allowedTeamIds: loaded.lane.allowedTeamIds,
        }
      : null,
    template.service
  );
  if (problem || !loaded.lane) {
    const status = problem ?? METRIC_EVALUATION_STATUS.NO_CONNECTION;
    const written = await record(item, template, settings, now, status, []);
    return { outcome: written ? 'skipped' : 'stale', status, anomalies: 0, created: 0 };
  }

  const connection = loaded.lane.connection;
  const fetchSeries = dependencies.fetchSeries ?? defaultFetcher(dependencies.fetch);
  const windows = evaluationWindows(now, template);
  const stepSeconds = template.stepSeconds;
  const failure = (error: unknown): string => {
    const code = error instanceof ConnectorError ? error.code : 'FAILED';
    return code === 'UNSUPPORTED'
      ? METRIC_EVALUATION_STATUS.UNSUPPORTED
      : `${METRIC_EVALUATION_STATUS.CONNECTOR_ERROR}:${code}`;
  };

  let current: ReturnType<typeof boundSeries>;
  try {
    current = boundSeries(
      await fetchSeries(
        connection,
        { query: template.query, window: windows.current, stepSeconds },
        signal
      )
    );
  } catch (error) {
    if (signal.aborted) throw error;
    const status = failure(error);
    logger.info('[Intelligence] Metric template evaluation degraded', {
      templateId: template.id,
      kind: connection.kind,
      status,
    });
    const written = await record(item, template, settings, now, status, []);
    return { outcome: written ? 'degraded' : 'stale', status, anomalies: 0, created: 0 };
  }

  if (current.every(series => series.points.length === 0)) {
    const status = METRIC_EVALUATION_STATUS.NO_DATA;
    const written = await record(item, template, settings, now, status, []);
    return { outcome: written ? 'evaluated' : 'stale', status, anomalies: 0, created: 0 };
  }

  // A week that fails is a gap in the baseline, not a failed evaluation.
  const weeks = await mapBounded(windows.history, METRIC_FETCH_CONCURRENCY, async week => {
    try {
      return {
        weeksAgo: week.weeksAgo,
        series: boundSeries(
          await fetchSeries(
            connection,
            { query: template.query, window: week.window, stepSeconds },
            signal
          )
        ),
      };
    } catch (error) {
      if (signal.aborted) throw error;
      return { weeksAgo: week.weeksAgo, series: [] };
    }
  });

  const options = {
    thresholdMad: template.thresholdMad,
    direction: template.direction as MetricDirection,
    stepMs: stepSeconds * 1000,
    minDeviation: template.minDeviation,
  };
  const detected: Detected[] = [];
  let judged = 0;
  for (const series of current) {
    const history: HistoryWeek[] = weeks.map(week => {
      const match =
        week.series.find(candidate => candidate.key === series.key) ??
        // One series on each side is the same series even if a label (a scope, a host) moved.
        (current.length === 1 && week.series.length === 1 ? week.series[0] : undefined);
      return { weeksAgo: week.weeksAgo, points: match?.points ?? [] };
    });
    judged += judgeSamples(series.points, history, options).filter(
      sample => sample.score !== null
    ).length;
    for (const deviation of detectDeviations(series.points, history, options))
      detected.push({ ...deviation, seriesKey: series.key, labels: series.labels });
  }
  const strongest = detected
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, METRIC_TEMPLATE_BOUNDS.maxDeviationsPerEvaluation);
  const status =
    judged === 0 ? METRIC_EVALUATION_STATUS.THIN_BASELINE : METRIC_EVALUATION_STATUS.OK;
  const written = await record(item, template, settings, now, status, strongest);
  if (written === null) return { outcome: 'stale', status, anomalies: 0, created: 0 };
  return { outcome: 'evaluated', status, anomalies: strongest.length, created: written.created };
}

/**
 * Writes the outcome in one budgeted transaction, fenced on the generation: the template row is locked and
 * a newer generation already recorded wins. A deviation that overlaps or directly continues one already
 * stored for the same series (the windows of consecutive evaluations overlap) extends it instead of adding
 * a duplicate. Incidents a new anomaly may explain are re-signalled for response analysis.
 */
async function record(
  item: Pick<ClaimedWorkItem, 'generation'>,
  template: TemplateRow,
  settings: { maxDbMs: number },
  now: Date,
  status: string,
  deviations: readonly Detected[]
): Promise<{ created: number } | null> {
  const code = status.split(':')[0];
  const result = await withDbBudget(settings, async tx => {
    const [locked] = await tx.$queryRaw<Array<{ lastGeneration: number; enabled: boolean }>>(
      Prisma.sql`SELECT "lastGeneration", "enabled" FROM "ServiceMetricTemplate"
        WHERE "id" = ${template.id} FOR UPDATE`
    );
    if (!locked || locked.lastGeneration > item.generation) return null;
    const stepMs = template.stepSeconds * 1000;
    let created = 0;
    let earliestNew: number | null = null;
    for (const deviation of deviations) {
      const existing = await tx.metricAnomaly.findFirst({
        where: {
          templateId: template.id,
          seriesKey: deviation.seriesKey,
          at: { lte: new Date(deviation.endAt) },
          endAt: { gte: new Date(deviation.at - 2 * stepMs) },
        },
        orderBy: { at: 'desc' },
        select: { id: true, at: true, endAt: true, score: true, points: true },
      });
      const peak = {
        peakAt: new Date(deviation.peakAt),
        direction: deviation.direction,
        score: deviation.score,
        value: deviation.value,
        baselineMedian: deviation.baselineMedian,
        baselineMad: deviation.baselineMad,
        baselineSamples: deviation.baselineSamples,
      };
      if (existing) {
        const endAt = Math.max(existing.endAt.getTime(), deviation.endAt);
        await tx.metricAnomaly.update({
          where: { id: existing.id },
          data: {
            endAt: new Date(endAt),
            points: Math.max(
              existing.points,
              Math.round((endAt - existing.at.getTime()) / stepMs) + 1
            ),
            generation: item.generation,
            ...(deviation.score > existing.score ? peak : {}),
          },
        });
        continue;
      }
      await tx.metricAnomaly.create({
        data: {
          templateId: template.id,
          serviceId: template.serviceId,
          seriesKey: deviation.seriesKey,
          labels: deviation.labels,
          at: new Date(deviation.at),
          endAt: new Date(deviation.endAt),
          points: deviation.points,
          generation: item.generation,
          ...peak,
        },
      });
      created += 1;
      earliestNew = Math.min(earliestNew ?? deviation.at, deviation.at);
    }
    await tx.serviceMetricTemplate.update({
      where: { id: template.id },
      data: { lastEvaluatedAt: now, lastStatus: status, lastGeneration: item.generation },
    });
    if (earliestNew !== null)
      await reanalyzeAfterLateChange(
        template.serviceId,
        new Date(earliestNew - METRIC_EVIDENCE_GRACE_MINUTES * 60_000),
        tx
      );
    return { created };
  });
  if (result)
    addOperationalMetric('opsknight_intelligence_metric_evaluations_total', 1, { status: code });
  return result;
}
