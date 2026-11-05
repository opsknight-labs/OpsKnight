import 'server-only';
import { logger } from '@/lib/logger';
import { getIntelligenceLaneStatus, type LaneStatus } from './jobs/runner';
import { getWorkBacklog } from './jobs/work-queue';

/** A lane that has not completed a cycle for this long is wedged, not merely idle (idle polls every few seconds). */
export const LANE_STALE_AFTER_MS = 120_000;

export type LaneHealth =
  | { status: 'healthy' }
  | { status: 'disabled'; expected: false }
  | { status: 'degraded'; error: string };

/**
 * Health of this instance's intelligence lane. It is never "unhealthy": intelligence is optional and
 * advisory, so a stuck lane must be visible without ever failing readiness and pulling a replica out
 * of rotation. Messages are fixed strings; nothing from the database or an exception is exposed.
 */
export function evaluateLaneHealth(status: LaneStatus, now: number = Date.now()): LaneHealth {
  if (!status.running || status.lastResult?.status === 'disabled') return { status: 'disabled', expected: false };
  if (status.paused) return { status: 'degraded', error: 'Paused to protect paging; resumes automatically' };
  if (status.lastCycleAt && now - status.lastCycleAt.getTime() > LANE_STALE_AFTER_MS) {
    return { status: 'degraded', error: 'Lane has not completed a cycle recently' };
  }
  return { status: 'healthy' };
}

export function getIntelligenceHealthCheck() {
  return evaluateLaneHealth(getIntelligenceLaneStatus());
}

export interface IntelligenceMetricSample {
  name:
    | 'opsknight_intelligence_queue_ready'
    | 'opsknight_intelligence_queue_oldest_ready_age_seconds'
    | 'opsknight_intelligence_dead_letters'
    | 'opsknight_intelligence_lane_paused'
    | 'opsknight_intelligence_lane_last_cycle_age_seconds';
  value: number;
}

/** Best effort: a failing probe yields fewer samples and never fails the scrape. */
export async function collectIntelligenceMetrics(now: number = Date.now()): Promise<IntelligenceMetricSample[]> {
  const samples: IntelligenceMetricSample[] = [];
  const lane = getIntelligenceLaneStatus();
  if (lane.running) {
    samples.push({ name: 'opsknight_intelligence_lane_paused', value: lane.paused ? 1 : 0 });
    if (lane.lastCycleAt) {
      samples.push({
        name: 'opsknight_intelligence_lane_last_cycle_age_seconds',
        value: Math.max(0, (now - lane.lastCycleAt.getTime()) / 1000),
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
      { name: 'opsknight_intelligence_dead_letters', value: backlog.deadLetters }
    );
  } catch (error) {
    logger.debug('[Intelligence] Metrics backlog probe failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return samples;
}
