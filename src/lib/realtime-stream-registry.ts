import { addOperationalMetric, setOperationalGauge } from '@/lib/metrics/operational/registry';

/**
 * Process-local registry of open SSE streams. It exists so a shutting-down replica can release
 * every stream (and with it every change-clock subscription and timer) instead of leaving
 * browsers attached to a dying process, and so operators can see connection counts. It holds only
 * close callbacks and a mode label: never user or incident identifiers.
 */
export type StreamMode = 'full' | 'signal';
export type StreamCloseReason = 'client' | 'slow_consumer' | 'revoked' | 'shutdown' | 'error';

type Entry = { mode: StreamMode; close: (reason: StreamCloseReason) => void };

const streams = new Set<Entry>();
let draining = false;
let drainTimers: Array<ReturnType<typeof setTimeout>> = [];

function publishCounts(): void {
  for (const mode of ['full', 'signal'] as const) {
    let count = 0;
    for (const entry of streams) if (entry.mode === mode) count += 1;
    setOperationalGauge('opsknight_realtime_streams_active', count, { mode });
  }
}

export function registerRealtimeStream(
  mode: StreamMode,
  close: (reason: StreamCloseReason) => void
): () => void {
  const entry: Entry = { mode, close };
  streams.add(entry);
  addOperationalMetric('opsknight_realtime_streams_opened_total', 1, { mode });
  publishCounts();
  return () => {
    streams.delete(entry);
    publishCounts();
  };
}

export function recordRealtimeStreamClosed(reason: StreamCloseReason): void {
  addOperationalMetric('opsknight_realtime_streams_closed_total', 1, { reason });
}

export function activeRealtimeStreamCount(): number {
  return streams.size;
}

/** New connections are refused (503 + Retry-After) while the process is draining. */
export function isRealtimeDraining(): boolean {
  return draining;
}

/**
 * Begin draining: refuse new streams and close the open ones, spread over `spreadMs` so the
 * browsers they belong to do not all reconnect to the surviving replicas in the same instant.
 * Clients treat the close as a recoverable disconnect and re-read canonical state on reconnect.
 */
export function drainRealtimeStreams(spreadMs = 3_000): number {
  draining = true;
  const open = [...streams];
  for (const entry of open) {
    const timer = setTimeout(
      () => entry.close('shutdown'),
      Math.floor(Math.random() * Math.max(0, spreadMs))
    );
    timer.unref?.();
    drainTimers.push(timer);
  }
  return open.length;
}

export function resetRealtimeStreamRegistryForTests(): void {
  for (const timer of drainTimers) clearTimeout(timer);
  drainTimers = [];
  streams.clear();
  draining = false;
}
