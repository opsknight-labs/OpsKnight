import { burnRate } from '../burn';
import {
  SLO_ALERT_BOUNDS,
  SLO_BURN_TIERS,
  SLO_BURN_WINDOWS,
  sloAlertRank,
  type SloAlertState,
  type SloBurnByWindow,
  type SloBurnWindow,
} from './contract';

/** Pure burn-rate arithmetic and the alert state machine; no I/O, so every rule is table-tested. */

export interface SliPoint {
  /** Start of the step, epoch milliseconds. */
  at: number;
  good: number;
  total: number;
}

const MINUTE = 60_000;

/** Burn over a window, or null when the window saw no events (no traffic is not an outage). */
export function burnOf(good: number, total: number, targetPercent: number): number | null {
  if (!(total > 0)) return null;
  const bad = Math.max(0, total - Math.min(good, total));
  return burnRate(bad, total, targetPercent);
}

/** Burn of every window ending at `end` (exclusive), from steps that start inside the window. */
export function windowBurns(
  points: readonly SliPoint[],
  end: number,
  targetPercent: number
): SloBurnByWindow {
  const result = {} as SloBurnByWindow;
  for (const [key, minutes] of Object.entries(SLO_BURN_WINDOWS) as Array<[SloBurnWindow, number]>) {
    const start = end - minutes * MINUTE;
    let good = 0;
    let total = 0;
    for (const point of points) {
      if (point.at < start || point.at >= end) continue;
      good += point.good;
      total += point.total;
    }
    // eslint-disable-next-line security/detect-object-injection -- key is one of the fixed window names
    result[key] = burnOf(good, total, targetPercent);
  }
  return result;
}

export interface TierDecision {
  /** The highest tier that fires; OK when none does. */
  target: SloAlertState;
  /** Tiers whose long window the stored coverage spans; the others cannot fire yet. */
  armed: number;
}

/**
 * The highest firing tier. A tier fires when coverage spans its long window and both windows burn at or
 * above its threshold. With tickets switched off a ticket tier never fires.
 */
export function firingTier(
  burns: SloBurnByWindow,
  coverageMinutes: number,
  ticketsEnabled: boolean
): TierDecision {
  let target: SloAlertState = 'OK';
  let armed = 0;
  for (const tier of SLO_BURN_TIERS) {
    if (coverageMinutes < SLO_BURN_WINDOWS[tier.long]) continue;
    armed += 1;
    if (tier.tier === 'TICKET' && !ticketsEnabled) continue;
    const long = burns[tier.long];
    const short = burns[tier.short];
    if (long === null || short === null) continue;
    if (
      long >= tier.threshold &&
      short >= tier.threshold &&
      sloAlertRank(tier.tier) > sloAlertRank(target)
    )
      target = tier.tier;
  }
  return { target, armed };
}

export interface AlertMachineState {
  state: SloAlertState;
  belowStreak: number;
}

/**
 * Escalates at once; steps down only after `deEscalateAfter` evaluations in a row below the current state,
 * to the tier of the latest one. Resolution is a step down to OK, so it too waits for clean evaluations.
 */
export function nextAlertState(
  current: AlertMachineState,
  target: SloAlertState
): AlertMachineState {
  const rank = sloAlertRank(target);
  const now = sloAlertRank(current.state);
  if (rank > now) return { state: target, belowStreak: 0 };
  if (rank === now) return { state: current.state, belowStreak: 0 };
  const streak = current.belowStreak + 1;
  if (streak >= SLO_ALERT_BOUNDS.deEscalateAfter) return { state: target, belowStreak: 0 };
  return { state: current.state, belowStreak: streak };
}

/** The step that contains the instant just before `at`: a point at t counts the step ending at t. */
export function bucketOf(at: number, stepMs: number): number {
  return Math.floor((at - 1) / stepMs) * stepMs;
}

/** Sums every series of a query into one value per step. */
export function sumByBucket(
  series: ReadonlyArray<{ points: ReadonlyArray<readonly [number, number]> }>,
  stepMs: number,
  from: number,
  end: number
): Map<number, number> {
  const sums = new Map<number, number>();
  for (const item of series)
    for (const [at, value] of item.points) {
      if (!Number.isFinite(at) || !Number.isFinite(value) || value < 0) continue;
      const bucket = bucketOf(at, stepMs);
      if (bucket < from || bucket >= end) continue;
      sums.set(bucket, (sums.get(bucket) ?? 0) + value);
    }
  return sums;
}

/** Joins good and total per step; a step without a total is no measurement and is dropped. */
export function joinSli(good: Map<number, number>, total: Map<number, number>): SliPoint[] {
  return [...total.entries()]
    .map(([at, totalValue]) => ({
      at,
      good: Math.min(good.get(at) ?? 0, totalValue),
      total: totalValue,
    }))
    .sort((a, b) => a.at - b.at);
}
