import 'server-only';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { CONNECTOR_ADAPTERS } from '@/lib/intelligence/connectors/adapters';
import type {
  MetricsQuery,
  ResolvedConnection,
} from '@/lib/intelligence/connectors/adapters/types';
import { ConnectorError, type ConnectorFetch } from '@/lib/intelligence/connectors/http';
import type { RawSeries } from '@/lib/intelligence/connectors/normalize';
import { contextFor, loadConnectionForLane } from '@/lib/intelligence/connectors/service';
import { withDbBudget } from '@/lib/intelligence/jobs/db-budget';
import type { ClaimedWorkItem } from '@/lib/intelligence/jobs/work-queue';
import { connectionScopeProblem } from '@/lib/intelligence/metric-anomaly/service';
import {
  SLO_ALERT_BOUNDS,
  SLO_ALERT_STATUS,
  SLO_ALERTABLE_METRICS,
  SLO_BURN_TIERS,
  isSloAlertState,
  sloAlertRank,
  type SloAlertState,
  type SloBurnByWindow,
} from './contract';
import {
  firingTier,
  joinSli,
  nextAlertState,
  sumByBucket,
  windowBurns,
  type SliPoint,
} from './tiers';

/**
 * The lane job behind EVALUATE_SLO_POLICY. It reads one policy, asks its connection for the good and total
 * counts of the steps it has not stored yet (a first run backfills the longest window), stores them, works
 * out the burn of every window and moves the alert state: up at once, down only after clean evaluations.
 * A state change raises or resolves one incident through the normal event path under the dedup key
 * `slo:<objective>`, so a ticket that becomes a page is the same incident with its urgency raised.
 * Never on the paging path; every statement is budgeted; network calls run outside any transaction; a
 * connector that fails records its status and the item completes. Results are fenced on the work generation.
 */

export const SLO_INTEGRATION_ID = 'slo:burn-alerts';
export const sloDedupKey = (lineageId: string) => `slo:${lineageId}`;

export type SloSeriesFetcher = (
  connection: ResolvedConnection,
  query: MetricsQuery,
  signal: AbortSignal
) => Promise<RawSeries[]>;

type ProcessEvent = typeof import('@/lib/events').processEvent;

export interface SloEvaluationDependencies {
  fetch?: ConnectorFetch;
  fetchSeries?: SloSeriesFetcher;
  processEvent?: ProcessEvent;
  now?: () => Date;
}

export interface SloEvaluationResult {
  outcome: 'evaluated' | 'skipped' | 'degraded' | 'stale' | 'gone';
  status: string | null;
  state: SloAlertState | null;
  stored: number;
}

const MINUTE = 60_000;

const defaultFetcher =
  (fetch: ConnectorFetch | undefined): SloSeriesFetcher =>
  async (connection, query, signal) => {
    const adapter = CONNECTOR_ADAPTERS[connection.kind];
    if (!adapter?.series)
      throw new ConnectorError('UNSUPPORTED', 'This connection cannot answer metric queries');
    return adapter.series(contextFor(connection, { fetch, signal }), query);
  };

const POLICY_SELECT = {
  id: true,
  lineageId: true,
  serviceId: true,
  connectionId: true,
  goodQuery: true,
  totalQuery: true,
  stepSeconds: true,
  enabled: true,
  ticketsEnabled: true,
  state: true,
  belowStreak: true,
  coverageFrom: true,
  lastIncidentId: true,
  lastGeneration: true,
  service: { select: { teamId: true, name: true } },
} as const;
type PolicyRow = Prisma.SloAlertPolicyGetPayload<{ select: typeof POLICY_SELECT }>;

/** The settings an evaluation acts on; a save that changes any of them makes an in-flight evaluation stale. */
const CONFIG_FIELDS = [
  'enabled',
  'connectionId',
  'goodQuery',
  'totalQuery',
  'stepSeconds',
  'ticketsEnabled',
] as const;
type ConfigRow = Pick<PolicyRow, (typeof CONFIG_FIELDS)[number]> & { lastGeneration: number };

function sameConfig(loaded: PolicyRow, current: ConfigRow | null | undefined, generation: number) {
  return (
    !!current &&
    current.lastGeneration <= generation &&
    // eslint-disable-next-line security/detect-object-injection -- keys are the fixed CONFIG_FIELDS constants
    CONFIG_FIELDS.every(field => current[field] === loaded[field])
  );
}

/** Re-reads the policy right before a side effect, so a save made while the connector was queried wins. */
async function stillCurrent(
  policy: PolicyRow,
  generation: number,
  settings: { maxDbMs: number }
): Promise<boolean> {
  const current = await withDbBudget(settings, tx =>
    tx.sloAlertPolicy.findUnique({
      where: { id: policy.id },
      select: { ...Object.fromEntries(CONFIG_FIELDS.map(f => [f, true])), lastGeneration: true },
    })
  );
  return sameConfig(policy, current as ConfigRow | null, generation);
}

interface Outcome {
  status: string;
  error?: string | null;
  points?: SliPoint[];
  coverageFrom?: Date | null;
  next?: { state: SloAlertState; belowStreak: number };
  transition?: { from: SloAlertState; to: SloAlertState; burns: SloBurnByWindow };
  incidentId?: string | null;
}

export async function evaluateSloPolicy(
  item: Pick<ClaimedWorkItem, 'subjectKey' | 'generation'>,
  settings: { maxDbMs: number },
  signal: AbortSignal,
  dependencies: SloEvaluationDependencies = {}
): Promise<SloEvaluationResult> {
  const now = dependencies.now?.() ?? new Date();
  const loaded = await withDbBudget(settings, async tx => {
    const policy = await tx.sloAlertPolicy.findUnique({
      where: { id: item.subjectKey },
      select: POLICY_SELECT,
    });
    if (!policy || policy.lastGeneration > item.generation) return { policy, objective: null };
    const objective = await tx.serviceObjective.findFirst({
      // The current definition: an edit's new target applies from the next evaluation.
      where: { lineageId: policy.lineageId, activeTo: null },
      select: { name: true, target: true, metricType: true, serviceId: true },
    });
    return { policy, objective };
  });
  const { policy, objective } = loaded;
  if (!policy) return { outcome: 'gone', status: null, state: null, stored: 0 };
  if (policy.lastGeneration > item.generation)
    return { outcome: 'stale', status: null, state: null, stored: 0 };
  const state: SloAlertState = isSloAlertState(policy.state) ? policy.state : 'OK';
  const emit = dependencies.processEvent ?? (await import('@/lib/events')).processEvent;

  const usable =
    objective &&
    objective.serviceId === policy.serviceId &&
    (SLO_ALERTABLE_METRICS as readonly string[]).includes(objective.metricType);
  if (!policy.enabled || !usable) {
    const status = policy.enabled ? SLO_ALERT_STATUS.OBJECTIVE_INACTIVE : SLO_ALERT_STATUS.DISABLED;
    // Switched off (or the objective is gone) while alerting: close what it opened, once.
    const outcome: Outcome = { status, next: { state: 'OK', belowStreak: 0 } };
    if (state !== 'OK') {
      if (!(await stillCurrent(policy, item.generation, settings)))
        return { outcome: 'stale', status: null, state: null, stored: 0 };
      const resolved = await sendResolve(emit, policy, objective?.name ?? null);
      if (resolved) outcome.transition = { from: state, to: 'OK', burns: emptyBurns() };
      else outcome.next = { state, belowStreak: policy.belowStreak };
    }
    const written = await record(item, policy, settings, now, outcome);
    return {
      outcome: written ? 'skipped' : 'stale',
      status,
      state: outcome.next!.state,
      stored: 0,
    };
  }

  const stepMs = policy.stepSeconds * 1000;
  const end = Math.floor((now.getTime() - SLO_ALERT_BOUNDS.settleSeconds * 1000) / stepMs) * stepMs;
  const horizon = end - SLO_ALERT_BOUNDS.maxWindowMinutes * MINUTE;
  const [lane, stored] = await withDbBudget(settings, async tx =>
    Promise.all([
      policy.connectionId ? loadConnectionForLane(policy.connectionId, tx) : null,
      tx.sloSliPoint.findMany({
        where: { policyId: policy.id, bucketStart: { gte: new Date(horizon) } },
        orderBy: { bucketStart: 'asc' },
        select: { bucketStart: true, good: true, total: true },
      }),
    ])
  );
  const problem = connectionScopeProblem(
    lane
      ? { enabled: lane.enabled, kind: lane.connection.kind, allowedTeamIds: lane.allowedTeamIds }
      : null,
    policy.service
  );
  if (problem || !lane) {
    const status = problem ?? SLO_ALERT_STATUS.NO_CONNECTION;
    const written = await record(item, policy, settings, now, { status });
    return { outcome: written ? 'skipped' : 'stale', status, state, stored: 0 };
  }

  const history: SliPoint[] = stored.map(point => ({
    at: point.bucketStart.getTime(),
    good: point.good,
    total: point.total,
  }));
  const last = history.at(-1)?.at;
  // Only steps not stored yet; a point at t counts the step ending at t, so ask from the first new step's end.
  const from = last !== undefined ? Math.max(last + stepMs, horizon) : horizon;
  let fresh: SliPoint[] = [];
  if (from < end) {
    const fetchSeries = dependencies.fetchSeries ?? defaultFetcher(dependencies.fetch);
    const window = { start: new Date(from + stepMs), end: new Date(end) };
    try {
      const [good, total] = await Promise.all([
        fetchSeries(
          lane.connection,
          { query: policy.goodQuery, window, stepSeconds: policy.stepSeconds },
          signal
        ),
        fetchSeries(
          lane.connection,
          { query: policy.totalQuery, window, stepSeconds: policy.stepSeconds },
          signal
        ),
      ]);
      const bound = (series: RawSeries[]) => series.slice(0, SLO_ALERT_BOUNDS.maxSeries);
      fresh = joinSli(
        sumByBucket(bound(good), stepMs, from, end),
        sumByBucket(bound(total), stepMs, from, end)
      );
    } catch (error) {
      if (signal.aborted) throw error;
      const code = error instanceof ConnectorError ? error.code : 'FAILED';
      const status =
        code === 'UNSUPPORTED'
          ? SLO_ALERT_STATUS.UNSUPPORTED
          : `${SLO_ALERT_STATUS.CONNECTOR_ERROR}:${code}`;
      logger.info('[SLO] Burn-rate evaluation degraded', {
        policyId: policy.id,
        kind: lane.connection.kind,
        status,
      });
      const written = await record(item, policy, settings, now, { status });
      return { outcome: written ? 'degraded' : 'stale', status, state, stored: 0 };
    }
  } else {
    // Nothing new to ask for yet (evaluated again within the same step): only note that it ran.
    const written = await record(item, policy, settings, now, { status: SLO_ALERT_STATUS.OK });
    return {
      outcome: written ? 'skipped' : 'stale',
      status: SLO_ALERT_STATUS.OK,
      state,
      stored: 0,
    };
  }

  const points = [...history, ...fresh];
  const coverageFrom = policy.coverageFrom ?? (points[0] ? new Date(points[0].at) : null);
  const burns = windowBurns(points, end, objective.target);
  const coverageMinutes = coverageFrom ? (end - coverageFrom.getTime()) / MINUTE : 0;
  const decision = firingTier(burns, coverageMinutes, policy.ticketsEnabled);
  let next = nextAlertState({ state, belowStreak: policy.belowStreak }, decision.target);
  let status: string = points.length === 0 ? SLO_ALERT_STATUS.NO_DATA : SLO_ALERT_STATUS.OK;
  let incidentId: string | null | undefined;
  let transition: Outcome['transition'];

  if (next.state !== state) {
    // The connector calls above can take a while; never page or resolve on settings changed meanwhile.
    if (!(await stillCurrent(policy, item.generation, settings)))
      return { outcome: 'stale', status: null, state: null, stored: 0 };
    const raised = sloAlertRank(next.state) > sloAlertRank(state);
    let delivered = true;
    if (raised) {
      const id = await sendTrigger(emit, policy, objective, next.state as 'PAGE' | 'TICKET', burns);
      delivered = id !== false;
      if (id) incidentId = id;
    } else if (next.state === 'OK') {
      delivered = await sendResolve(emit, policy, objective.name);
    }
    if (delivered) transition = { from: state, to: next.state, burns };
    else {
      // Keep the old state so the next evaluation tries again rather than leaving a silent alert.
      status = SLO_ALERT_STATUS.EVENT_FAILED;
      next = { state, belowStreak: policy.belowStreak };
    }
  }

  const written = await record(item, policy, settings, now, {
    status,
    points: fresh,
    coverageFrom,
    next,
    transition,
    incidentId,
  });
  return {
    outcome: written ? 'evaluated' : 'stale',
    status,
    state: written ? next.state : null,
    stored: written ? fresh.length : 0,
  };
}

function emptyBurns(): SloBurnByWindow {
  return { '5m': null, '30m': null, '1h': null, '2h': null, '6h': null, '1d': null, '3d': null };
}

const formatBurn = (value: number | null) => (value === null ? 'n/a' : `${value}×`);

/** Raises (or raises the urgency of) the policy's incident; the incident id, null without one, false on failure. */
async function sendTrigger(
  emit: ProcessEvent,
  policy: PolicyRow,
  objective: { name: string; target: number },
  tier: 'PAGE' | 'TICKET',
  burns: SloBurnByWindow
): Promise<string | null | false> {
  const firing =
    SLO_BURN_TIERS.find(
      item =>
        item.tier === tier &&
        (burns[item.long] ?? 0) >= item.threshold &&
        (burns[item.short] ?? 0) >= item.threshold
    ) ?? SLO_BURN_TIERS.find(item => item.tier === tier)!;
  try {
    const outcome = await emit(
      {
        event_action: 'trigger',
        dedup_key: sloDedupKey(policy.lineageId),
        payload: {
          summary: `SLO "${objective.name}" is burning its error budget at ${formatBurn(burns[firing.long])} over ${firing.long}`,
          source: 'slo-burn-alerts',
          severity: tier === 'PAGE' ? 'critical' : 'warning',
          custom_details: {
            service_objective: policy.lineageId,
            target_percent: objective.target,
            tier,
            long_window: firing.long,
            short_window: firing.short,
            threshold: firing.threshold,
            burn_by_window: burns,
          },
        },
      },
      policy.serviceId,
      SLO_INTEGRATION_ID
    );
    return 'incident' in outcome && outcome.incident ? outcome.incident.id : null;
  } catch (error) {
    logger.warn('[SLO] Burn alert could not raise its incident; will retry', {
      policyId: policy.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function sendResolve(
  emit: ProcessEvent,
  policy: PolicyRow,
  name: string | null
): Promise<boolean> {
  try {
    await emit(
      {
        event_action: 'resolve',
        dedup_key: sloDedupKey(policy.lineageId),
        payload: {
          summary: `SLO "${name ?? policy.lineageId}" burn rate is back within budget`,
          source: 'slo-burn-alerts',
          severity: 'info',
        },
      },
      policy.serviceId,
      SLO_INTEGRATION_ID
    );
    return true;
  } catch (error) {
    logger.warn('[SLO] Burn alert could not resolve its incident; will retry', {
      policyId: policy.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Writes the outcome in one budgeted transaction, fenced on the generation; null when a newer run won. */
async function record(
  item: Pick<ClaimedWorkItem, 'generation'>,
  policy: PolicyRow,
  settings: { maxDbMs: number },
  now: Date,
  outcome: Outcome
): Promise<true | null> {
  return withDbBudget(settings, async tx => {
    const [locked] = await tx.$queryRaw<ConfigRow[]>(
      Prisma.sql`SELECT "lastGeneration", "enabled", "connectionId", "goodQuery", "totalQuery", "stepSeconds", "ticketsEnabled" FROM "SloAlertPolicy" WHERE "id" = ${policy.id} FOR UPDATE`
    );
    // A newer run won, or the settings changed since this run loaded them (their measurements would be wrong).
    if (!sameConfig(policy, locked, item.generation)) return null;
    if (outcome.points?.length)
      await tx.sloSliPoint.createMany({
        data: outcome.points.map(point => ({
          policyId: policy.id,
          bucketStart: new Date(point.at),
          good: point.good,
          total: point.total,
        })),
        skipDuplicates: true,
      });
    await tx.sloSliPoint.deleteMany({
      where: {
        policyId: policy.id,
        bucketStart: {
          lt: new Date(now.getTime() - SLO_ALERT_BOUNDS.retentionDays * 1440 * MINUTE),
        },
      },
    });
    const changed = outcome.transition !== undefined;
    await tx.sloAlertPolicy.update({
      where: { id: policy.id },
      data: {
        lastEvaluatedAt: now,
        lastStatus: outcome.status,
        lastError: outcome.error ?? null,
        lastGeneration: item.generation,
        ...(outcome.coverageFrom !== undefined ? { coverageFrom: outcome.coverageFrom } : {}),
        ...(outcome.next
          ? {
              state: outcome.next.state,
              belowStreak: outcome.next.belowStreak,
              ...(changed ? { stateSince: now } : {}),
            }
          : {}),
        ...(outcome.incidentId ? { lastIncidentId: outcome.incidentId } : {}),
      },
    });
    if (outcome.transition)
      await tx.sloAlertTransition.create({
        data: {
          policyId: policy.id,
          from: outcome.transition.from,
          to: outcome.transition.to,
          burnByWindow: outcome.transition.burns,
          incidentId:
            outcome.incidentId ?? (outcome.transition.to === 'OK' ? policy.lastIncidentId : null),
          at: now,
        },
      });
    return true;
  });
}
