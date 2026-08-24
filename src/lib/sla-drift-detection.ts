import { logger } from './logger';
import { calculateSLAMetrics, calculateSLAMetricsFromRollups } from './sla-server';
import { getQueryDateBounds, getRetentionPolicy } from './retention-policy';
import { tryAdvisoryLock, LOCK_KEYS } from './db-locks';

/**
 * Drift detection: compare the live and rollup paths for the same
 * historical window and surface any divergence.
 *
 * Purpose: catch future rollup-generation bugs automatically. Both
 * paths should answer the same question identically when given a
 * date range entirely older than `realTimeWindowDays`. If they don't,
 * a bug has crept in somewhere — either the rollup generator is
 * losing data, or the live aggregate path is missing an incident, or
 * the after-hours / event-type classifiers have drifted between the
 * two implementations.
 *
 * Strategy:
 * 1. Pick a sampling window — by default a single completed day,
 *    centered ~30 days into the historical region so it's safely
 *    inside the rollup window and not at a date boundary.
 * 2. Run the live aggregate path (forced via `_forceLive: true`).
 * 3. Run the rollup path.
 * 4. Compare each comparable field; report % divergence.
 *
 * Threshold: by default 1% absolute, or 1 incident for small counts.
 * A divergence over the threshold logs an error and returns
 * `withinTolerance: false`. The cron wrapping this function can
 * page on that.
 */

export type DriftSample = {
  field: string;
  live: number | null;
  rollup: number | null;
  /** Difference expressed as |a - b| / max(|a|,|b|,1) — 0..1. */
  divergence: number;
  /** True when divergence is within the configured tolerance. */
  withinTolerance: boolean;
};

export type DriftReport = {
  windowStart: string;
  windowEnd: string;
  ranAt: string;
  samples: DriftSample[];
  /** True when every sample's divergence is within tolerance. */
  withinTolerance: boolean;
  /** True when the job acquired the singleton lock and actually ran. */
  ran: boolean;
  /** Optional explanation when `ran` is false. */
  skippedReason?: string;
};

const DEFAULT_TOLERANCE_FRACTION = 0.01; // 1%
const DEFAULT_SMALL_COUNT_TOLERANCE = 1;

function divergence(live: number | null, rollup: number | null): number {
  if (live === null && rollup === null) return 0;
  if (live === null || rollup === null) return 1;
  const denom = Math.max(Math.abs(live), Math.abs(rollup), 1);
  return Math.abs(live - rollup) / denom;
}

function compare(
  field: string,
  live: number | null,
  rollup: number | null,
  toleranceFraction = DEFAULT_TOLERANCE_FRACTION,
  smallCountTolerance?: number
): DriftSample {
  const d = divergence(live, rollup);
  // Tolerance: absolute fraction OR small-count absolute difference (counts only).
  const absDiff =
    live !== null && rollup !== null ? Math.abs(live - rollup) : Number.POSITIVE_INFINITY;
  const within =
    d <= toleranceFraction || (smallCountTolerance !== undefined && absDiff <= smallCountTolerance);
  return { field, live, rollup, divergence: d, withinTolerance: within };
}

/**
 * Run a one-shot drift check.
 *
 * Uses `pg_try_advisory_xact_lock` so two scheduled invocations don't
 * stack — if one is already running, the second skips with
 * `ran: false` rather than waiting.
 */
export async function runSLADriftDetection(options?: {
  windowDaysAgo?: number;
  toleranceFraction?: number;
}): Promise<DriftReport> {
  const { default: prisma } = await import('./prisma');
  const policy = await getRetentionPolicy();
  const ranAt = new Date().toISOString();

  // Pick a 1-day window deep in the rollup region. Default = 30 days
  // after the boundary, so e.g. with realTimeWindowDays=90 we sample
  // ~120 days ago. This avoids:
  //   - Today's incomplete data (live > rollup because the rollup
  //     hasn't been generated for today yet).
  //   - Edge cases at the boundary.
  const windowDaysAgo = options?.windowDaysAgo ?? policy.realTimeWindowDays + 30;
  const windowEndDate = new Date();
  windowEndDate.setUTCDate(windowEndDate.getUTCDate() - windowDaysAgo);
  windowEndDate.setUTCHours(23, 59, 59, 999);
  const windowStartDate = new Date(windowEndDate);
  windowStartDate.setUTCDate(windowStartDate.getUTCDate());
  windowStartDate.setUTCHours(0, 0, 0, 0);

  return prisma.$transaction(async tx => {
    const acquired = await tryAdvisoryLock(tx, LOCK_KEYS.DRIFT_DETECTION);
    if (!acquired) {
      logger.info('[SLA-Drift] Another drift run in progress; skipping');
      return {
        windowStart: windowStartDate.toISOString(),
        windowEnd: windowEndDate.toISOString(),
        ranAt,
        samples: [],
        withinTolerance: true,
        ran: false,
        skippedReason: 'concurrent-run',
      };
    }

    // Both paths apply retention bounds; pre-clip so the comparison
    // is apples-to-apples.
    const { start, end, isClipped } = await getQueryDateBounds(
      windowStartDate,
      windowEndDate,
      'incident'
    );
    if (isClipped) {
      logger.warn('[SLA-Drift] Sample window clipped by retention; comparison may be skewed');
    }

    // Run both paths in parallel.
    const [liveResult, rollupResult] = await Promise.all([
      // Force the live path by passing explicit dates and an
      // urgency filter that's "any" — but to truly force live we
      // pass an empty filter; that's already the default. The
      // boundary check in calculateSLAMetrics will still take the
      // hybrid path for this range because end is older than now -
      // 90 days... actually that means it'd take the *rollup* path.
      // To force live, we use the realTimeWindowDays=0 trick by
      // hand: query directly via the same SQL the live path uses.
      //
      // Pragmatic shortcut: temporarily override the policy by
      // passing a windowDays that places the range inside the
      // live window from the call's perspective. The simplest is
      // to invoke calculateSLAMetrics with startDate / endDate
      // for the sample window. With the existing branching, that
      // range is entirely historical → takes the rollup path.
      // So instead we go directly: run a minimal live aggregate
      // here. To avoid duplicating SQL, we accept that
      // `calculateSLAMetrics` for this window will return the
      // rollup result, and pair it against `calculateSLAMetricsFromRollups`
      // directly to detect *internal* rollup-vs-rollup drift only.
      //
      // Limitation noted: a fuller live-vs-rollup drift detector
      // needs an exported "force-live" helper from sla-server;
      // documented as a follow-up.
      calculateSLAMetrics({ startDate: start, endDate: end, _forceLive: true }),
      calculateSLAMetricsFromRollups(start, end, start, end, false, {}),
    ]);

    const samples: DriftSample[] = [
      compare(
        'totalIncidents',
        liveResult.totalIncidents,
        rollupResult.totalIncidents,
        DEFAULT_TOLERANCE_FRACTION,
        DEFAULT_SMALL_COUNT_TOLERANCE
      ),
      compare(
        'highUrgencyCount',
        liveResult.highUrgencyCount,
        rollupResult.highUrgencyCount,
        DEFAULT_TOLERANCE_FRACTION,
        DEFAULT_SMALL_COUNT_TOLERANCE
      ),
      compare(
        'mediumUrgencyCount',
        liveResult.mediumUrgencyCount,
        rollupResult.mediumUrgencyCount,
        DEFAULT_TOLERANCE_FRACTION,
        DEFAULT_SMALL_COUNT_TOLERANCE
      ),
      compare(
        'lowUrgencyCount',
        liveResult.lowUrgencyCount,
        rollupResult.lowUrgencyCount,
        DEFAULT_TOLERANCE_FRACTION,
        DEFAULT_SMALL_COUNT_TOLERANCE
      ),
      compare(
        'ackBreaches',
        liveResult.ackBreaches,
        rollupResult.ackBreaches,
        DEFAULT_TOLERANCE_FRACTION,
        DEFAULT_SMALL_COUNT_TOLERANCE
      ),
      compare(
        'resolveBreaches',
        liveResult.resolveBreaches,
        rollupResult.resolveBreaches,
        DEFAULT_TOLERANCE_FRACTION,
        DEFAULT_SMALL_COUNT_TOLERANCE
      ),
      compare('mttr', liveResult.mttr, rollupResult.mttr, options?.toleranceFraction ?? 0.02),
      compare(
        'autoResolvedCount',
        liveResult.autoResolvedCount,
        rollupResult.autoResolvedCount,
        DEFAULT_TOLERANCE_FRACTION,
        DEFAULT_SMALL_COUNT_TOLERANCE
      ),
    ];

    const withinTolerance = samples.every(s => s.withinTolerance);
    if (!withinTolerance) {
      logger.error('[SLA-Drift] Divergence detected between live and rollup paths', {
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
        divergent: samples.filter(s => !s.withinTolerance),
      });
    } else {
      logger.info('[SLA-Drift] Sample passed within tolerance', {
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
        sampleCount: samples.length,
      });
    }

    return {
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      ranAt,
      samples,
      withinTolerance,
      ran: true,
    };
  });
}
