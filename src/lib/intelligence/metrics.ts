import 'server-only';
import { collectFeatureMetrics, type FeatureMetricName } from './feature-metrics';
import { logger } from '@/lib/logger';
import { getIntelligenceLaneStatus, type LaneStatus } from './jobs/runner';
import { getWorkBacklog, WORK_KINDS } from './jobs/work-queue';

/** A lane that has not completed a cycle for this long is wedged, not merely idle (idle polls every few seconds). */
export const LANE_STALE_AFTER_MS = 120_000;

export type LaneHealth =
  | { status: 'healthy' }
  | { status: 'disabled'; expected: false }
  | { status: 'degraded'; error: string };

/**
 * Health of this instance's intelligence lane. It is never "unhealthy": intelligence is optional and
 * advisory, so a stuck lane must be visible without ever failing readiness and pulling a replica out
 * of rotation. A lane that has never completed a cycle is judged from the moment it started, so one
 * that hangs on its very first cycle is reported too. Messages are fixed strings; nothing from the
 * database or an exception is exposed.
 */
export function evaluateLaneHealth(status: LaneStatus, now: number = Date.now()): LaneHealth {
  if (!status.running || status.lastResult?.status === 'disabled')
    return { status: 'disabled', expected: false };
  if (status.paused)
    return {
      status: 'degraded',
      error:
        status.pauseReason === 'pool'
          ? 'Paused for database pool pressure; resumes after measured recovery'
          : 'Paused to protect paging; resumes automatically',
    };
  if (status.saturated)
    return {
      status: 'degraded',
      error: 'Timed-out work is still holding database connections; new work is deferred',
    };
  const since = status.lastCycleAt ?? status.startedAt ?? null;
  if (since && now - since.getTime() > LANE_STALE_AFTER_MS) {
    return { status: 'degraded', error: 'Lane has not completed a cycle recently' };
  }
  return { status: 'healthy' };
}

export function getIntelligenceHealthCheck() {
  return evaluateLaneHealth(getIntelligenceLaneStatus());
}

export interface IntelligenceMetricSample {
  name:
    | FeatureMetricName
    | 'opsknight_intelligence_queue_ready'
    | 'opsknight_intelligence_queue_oldest_ready_age_seconds'
    | 'opsknight_intelligence_dead_letters'
    | 'opsknight_intelligence_work_quarantined'
    | 'opsknight_intelligence_lane_paused'
    | 'opsknight_intelligence_lane_up'
    | 'opsknight_intelligence_kind_paused'
    | 'opsknight_intelligence_timed_out_in_flight'
    | 'opsknight_intelligence_wake_leader'
    | 'opsknight_intelligence_pool_waiting_queries'
    | 'opsknight_intelligence_lane_last_cycle_age_seconds';
  value: number;
  labels?: Record<string, string>;
}

/** Best effort: a failing probe yields fewer samples and never fails the scrape. */
export async function collectIntelligenceMetrics(
  now: number = Date.now()
): Promise<IntelligenceMetricSample[]> {
  const samples: IntelligenceMetricSample[] = [];
  const lane = getIntelligenceLaneStatus();
  if (lane.running) {
    // Emitted from the first scrape after start: a crashed process makes the series vanish, and a lane
    // wedged on its first cycle already shows a growing age, so neither failure is silent.
    samples.push({ name: 'opsknight_intelligence_lane_up', value: 1 });
    samples.push({ name: 'opsknight_intelligence_lane_paused', value: lane.paused ? 1 : 0 });
    samples.push({
      name: 'opsknight_intelligence_timed_out_in_flight',
      value: lane.timedOutInFlight,
    });
    if (lane.wakeLeader !== null)
      samples.push({ name: 'opsknight_intelligence_wake_leader', value: lane.wakeLeader ? 1 : 0 });
    for (const kind of Object.values(WORK_KINDS))
      samples.push({
        name: 'opsknight_intelligence_kind_paused',
        value: lane.pausedKinds.includes(kind) ? 1 : 0,
        labels: { kind },
      });
    if (lane.poolWaitingQueries !== null && lane.poolWaitingQueries !== undefined)
      samples.push({
        name: 'opsknight_intelligence_pool_waiting_queries',
        value: lane.poolWaitingQueries,
      });
    const since = lane.lastCycleAt ?? lane.startedAt;
    if (since) {
      samples.push({
        name: 'opsknight_intelligence_lane_last_cycle_age_seconds',
        value: Math.max(0, (now - since.getTime()) / 1000),
      });
    }
  }
  try {
    const backlog = await getWorkBacklog();
    samples.push(
      { name: 'opsknight_intelligence_queue_ready', value: backlog.ready },
      {
        name: 'opsknight_intelligence_queue_oldest_ready_age_seconds',
        value: backlog.oldestReadyAgeMs === null ? 0 : backlog.oldestReadyAgeMs / 1000,
      },
      { name: 'opsknight_intelligence_dead_letters', value: backlog.deadLetters },
      { name: 'opsknight_intelligence_work_quarantined', value: backlog.quarantined }
    );
  } catch (error) {
    logger.debug('[Intelligence] Metrics backlog probe failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  samples.push(...(await collectFeatureMetrics(new Date(now))));
  return samples;
}
