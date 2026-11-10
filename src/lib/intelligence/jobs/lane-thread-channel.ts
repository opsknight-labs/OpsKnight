import { readSharedIngestionActivity } from '@/lib/ingestion/activity';
import {
  exportRuntimeOperationalMetricState,
  type RuntimeOperationalMetricState,
} from '@/lib/metrics/operational/registry';
import type { LaneHost, LaneStatus } from './runner';

/**
 * The protocol between an `integrated` process's main thread and the worker thread running its
 * intelligence lane (see lane-thread.ts). Shared memory carries what the lane polls often and the main
 * thread must not pay a message for: ingestion activity (written on every event) and the main pool's
 * waiting-query count. Messages carry the rest.
 */
export interface LaneThreadData {
  /** Written by the main thread's ingestion activity counter (see ingestion/activity.ts). */
  activity: SharedArrayBuffer;
  /** One int32: queries waiting for a connection on the main thread's pool, -1 when unknown. */
  poolWaiting: SharedArrayBuffer;
}

/** Thread to main. */
export type LaneThreadReport =
  | { type: 'status'; status: LaneStatus; metrics: RuntimeOperationalMetricState }
  | { type: 'stopped' };

/** Main to thread. */
export type LaneThreadCommand = { type: 'stop' };

export const POOL_WAITING_UNKNOWN = -1;

export function createPoolWaitingBuffer(): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(4);
  Atomics.store(new Int32Array(buffer), 0, POOL_WAITING_UNKNOWN);
  return buffer;
}

export function writePoolWaiting(buffer: SharedArrayBuffer, waiting: number | null): void {
  Atomics.store(
    new Int32Array(buffer),
    0,
    waiting === null || !Number.isFinite(waiting) || waiting < 0
      ? POOL_WAITING_UNKNOWN
      : Math.min(2 ** 31 - 1, Math.floor(waiting))
  );
}

export function readPoolWaiting(buffer: SharedArrayBuffer): number | null {
  const value = Atomics.load(new Int32Array(buffer), 0);
  return value < 0 ? null : value;
}

/** What the lane observes when it runs in a thread: the main thread's ingestion and pool, not its own. */
export function laneHostForThread(data: LaneThreadData): Required<Omit<LaneHost, 'onCycle'>> {
  return {
    activity: () => readSharedIngestionActivity(data.activity),
    poolWaitingQueries: async () => readPoolWaiting(data.poolWaiting),
  };
}

interface Port {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  close(): void;
}

/** Statuses are sent at most this often (the last one is always sent), so a busy lane costs the main thread little. */
export const STATUS_REPORT_INTERVAL_MS = 1_000;

/**
 * Serves the main thread from inside a lane thread: reports status (with the thread's metrics) after
 * cycles, and on `stop` stops the lane, sends a last status and `stopped`, then closes the port.
 */
export function serveLaneThread(
  port: Port,
  lane: {
    status: () => LaneStatus;
    stop: () => Promise<void>;
  },
  options: { reportIntervalMs?: number; now?: () => number } = {}
) {
  const interval = options.reportIntervalMs ?? STATUS_REPORT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const send = () => {
    if (closed) return;
    if (trailing) clearTimeout(trailing);
    trailing = null;
    lastSentAt = now();
    const report: LaneThreadReport = {
      type: 'status',
      status: lane.status(),
      metrics: exportRuntimeOperationalMetricState(),
    };
    port.postMessage(report);
  };
  const report = () => {
    if (closed) return;
    const wait = lastSentAt + interval - now();
    if (wait <= 0) return send();
    trailing ??= setTimeout(send, wait);
    trailing.unref?.();
  };
  let stopping: Promise<void> | null = null;
  port.on('message', message => {
    if ((message as LaneThreadCommand | null)?.type !== 'stop' || stopping) return;
    stopping = (async () => {
      try {
        await lane.stop();
      } catch {
        // The thread exits either way; the main thread terminates it after `stopped`.
      } finally {
        send();
        closed = true;
        port.postMessage({ type: 'stopped' } satisfies LaneThreadReport);
        port.close();
      }
    })();
  });
  return { report, flush: send };
}
