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

declare global {
  var opsKnightIngestionActivity: ActivityState | undefined;
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

/** Marks one event as being ingested; call the returned function exactly once when it finishes. */
export function beginIngestionActivity(): () => void {
  advance(performance.now());
  state.inFlight += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    advance(performance.now());
    state.inFlight = Math.max(0, state.inFlight - 1);
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
