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
 * A copy of the state in shared memory, for a lane running in a worker thread of this process (see
 * intelligence/jobs/lane-thread.ts). `seq` is a sequence lock: odd while a write is in progress.
 * `values` holds inFlight, integralMs and changedAt as epoch milliseconds (threads have different
 * `performance.now()` origins).
 */
interface ActivityMirror {
  seq: Int32Array;
  values: Float64Array;
}

declare global {
  var opsKnightIngestionActivity: ActivityState | undefined;
  var opsKnightIngestionActivityMirror: ActivityMirror | undefined;
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

/** Copies the state into shared memory when a lane thread reads it; a no-op otherwise. */
function publish() {
  const mirror = globalThis.opsKnightIngestionActivityMirror;
  if (!mirror) return;
  Atomics.add(mirror.seq, 0, 1);
  mirror.values[0] = state.inFlight;
  mirror.values[1] = state.integralMs;
  mirror.values[2] = performance.timeOrigin + state.changedAt;
  Atomics.add(mirror.seq, 0, 1);
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

/** Bytes of shared memory a mirror needs: an 8-byte sequence word, then three float64 values. */
const MIRROR_BYTES = 8 + 3 * 8;

/**
 * Starts copying this thread's ingestion activity into shared memory and returns it, so a lane in a
 * worker thread can back off while this thread ingests. Idempotent: every caller gets the same buffer.
 */
export function shareIngestionActivity(): SharedArrayBuffer {
  const existing = globalThis.opsKnightIngestionActivityMirror;
  if (existing) return existing.seq.buffer as SharedArrayBuffer;
  const buffer = new SharedArrayBuffer(MIRROR_BYTES);
  globalThis.opsKnightIngestionActivityMirror = {
    seq: new Int32Array(buffer, 0, 1),
    values: new Float64Array(buffer, 8, 3),
  };
  advance(performance.now());
  publish();
  return buffer;
}

/**
 * Reads activity shared by another thread (see `shareIngestionActivity`) as a snapshot on this thread's
 * clock. A read that keeps racing a write returns the last copy it saw; the signal is advisory.
 */
export function readSharedIngestionActivity(
  buffer: SharedArrayBuffer,
  now: number = performance.now()
): IngestionActivitySnapshot {
  const seq = new Int32Array(buffer, 0, 1);
  const values = new Float64Array(buffer, 8, 3);
  let inFlight = 0;
  let integralMs = 0;
  let changedAtEpoch = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const before = Atomics.load(seq, 0);
    inFlight = values[0];
    integralMs = values[1];
    changedAtEpoch = values[2];
    if (before % 2 === 0 && Atomics.load(seq, 0) === before) break;
  }
  const nowEpoch = performance.timeOrigin + now;
  const pending = changedAtEpoch > 0 ? Math.max(0, nowEpoch - changedAtEpoch) : 0;
  return { inFlight, integralMs: integralMs + inFlight * pending, at: now };
}
