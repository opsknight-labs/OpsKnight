/**
 * In-process ingestion activity: how many `processEvent` calls are running in this process right now and
 * the time integral of that count. Background work that shares the process (the intelligence lane in
 * `integrated`) reads it to back off while ingestion is busy.
 *
 * Hot-path cost is two clock reads and a few arithmetic operations per event: no I/O, no allocation
 * beyond the release closure, nothing that can throw.
 */
interface ActivityState {
  inFlight: number;
  /** Integral of `inFlight` over time, in event-milliseconds, up to `changedAt`. */
  integralMs: number;
  changedAt: number;
}

/**
 * The state as another process sees it (see intelligence/jobs/lane-thread.ts): in-flight count,
 * integral, and the time of the last change in epoch milliseconds (processes have different
 * `performance.now()` origins).
 */
export type IngestionActivityValues = [
  inFlight: number,
  integralMs: number,
  changedAtEpoch: number,
];

declare global {
  var opsKnightIngestionActivity: ActivityState | undefined;
  var opsKnightIngestionActivityMirror: ((values: IngestionActivityValues) => void) | undefined;
}

// Next.js may evaluate this module in several chunks; every chunk must count into the same state.
const state: ActivityState = (globalThis.opsKnightIngestionActivity ??= {
  inFlight: 0,
  integralMs: 0,
  changedAt: performance.now(),
});

function advance(now: number) {
  if (now > state.changedAt) {
    state.integralMs += state.inFlight * (now - state.changedAt);
    state.changedAt = now;
  }
}

/** Hands the state to the mirror when a lane process reads it; a no-op otherwise. The mirror must not throw. */
function publish() {
  globalThis.opsKnightIngestionActivityMirror?.([
    state.inFlight,
    state.integralMs,
    performance.timeOrigin + state.changedAt,
  ]);
}

/** Marks one event as being ingested; call the returned function exactly once when it finishes. */
export function beginIngestionActivity(): () => void {
  advance(performance.now());
  state.inFlight += 1;
  publish();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    advance(performance.now());
    state.inFlight = Math.max(0, state.inFlight - 1);
    publish();
  };
}

export interface IngestionActivitySnapshot {
  inFlight: number;
  /** Integral of the in-flight count over time, in event-milliseconds. */
  integralMs: number;
  at: number;
}

export function snapshotIngestionActivity(
  now: number = performance.now()
): IngestionActivitySnapshot {
  advance(now);
  return { inFlight: state.inFlight, integralMs: state.integralMs, at: now };
}

/** Average number of events in flight between two snapshots (the current count when no time passed). */
export function averageInFlight(
  from: IngestionActivitySnapshot,
  to: IngestionActivitySnapshot
): number {
  const elapsed = to.at - from.at;
  return elapsed > 0 ? Math.max(0, (to.integralMs - from.integralMs) / elapsed) : to.inFlight;
}

/**
 * Calls `mirror` with the state on every change (and once now), so a lane in another process can back off
 * while this process ingests; null stops it. The mirror runs on the ingestion hot path: it must be cheap
 * and must not throw.
 */
export function mirrorIngestionActivity(
  mirror: ((values: IngestionActivityValues) => void) | null
) {
  globalThis.opsKnightIngestionActivityMirror = mirror ?? undefined;
  advance(performance.now());
  publish();
}

/** Reads mirrored activity (see `mirrorIngestionActivity`) as a snapshot on this process's clock. */
export function readMirroredIngestionActivity(
  [inFlight, integralMs, changedAtEpoch]: IngestionActivityValues,
  now: number = performance.now()
): IngestionActivitySnapshot {
  const nowEpoch = performance.timeOrigin + now;
  const pending = changedAtEpoch > 0 ? Math.max(0, nowEpoch - changedAtEpoch) : 0;
  return { inFlight, integralMs: integralMs + inFlight * pending, at: now };
}
