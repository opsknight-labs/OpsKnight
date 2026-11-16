import {
  readMirroredIngestionActivity,
  type IngestionActivityValues,
} from '@/lib/ingestion/activity';
import {
  exportRuntimeOperationalMetricState,
  type RuntimeOperationalMetricState,
} from '@/lib/metrics/operational/registry';
import type { LaneHost, LaneStatus } from './runner';

/**
 * The protocol between an `integrated` process and the child process running its intelligence lane (see
 * lane-thread.ts; the "lane thread" is a forked process). Everything travels over the IPC channel: the
 * lane reads ingestion activity and the main pool's waiting-query count from the last values the parent
 * sent (the parent bounds how often it sends them), and reports its status and metrics back.
 */

/** Child to parent. */
export type LaneThreadReport =
  | { type: 'status'; status: LaneStatus; metrics: RuntimeOperationalMetricState }
  | { type: 'stopped' };

/** Parent to child. */
export type LaneThreadCommand =
  | { type: 'stop' }
  | { type: 'activity'; values: IngestionActivityValues }
  | { type: 'pool'; waiting: number | null };

/** What the lane observes in its own process: the parent's ingestion and pool, as last sent. */
export function laneHostForThread(
  port: Pick<Port, 'on'>
): Required<Omit<LaneHost, 'onCycle' | 'handOffWhenEnabled'>> {
  let activity: IngestionActivityValues = [0, 0, 0];
  let poolWaiting: number | null = null;
  port.on('message', message => {
    const command = message as LaneThreadCommand | null;
    if (command?.type === 'activity') activity = command.values;
    else if (command?.type === 'pool') poolWaiting = command.waiting;
  });
  return {
    activity: () => readMirroredIngestionActivity(activity),
    poolWaitingQueries: async () => poolWaiting,
  };
}

export interface Port {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  close(): void;
}

/**
 * This lane process's channel to its parent. The parent ends the process after `stopped`, so `close` has
 * nothing to do; a parent that goes away disconnects the channel and the process exits (see the entry).
 */
export function parentProcessPort(proc: NodeJS.Process = process): Port {
  const send = proc.send?.bind(proc);
  if (!send) throw new Error('The intelligence lane entry must run as a forked child process');
  return {
    postMessage: message => {
      // A send that races the channel closing reports to its callback instead of throwing.
      if (proc.connected) send(message, undefined, {}, () => {});
    },
    on: (event, listener) => proc.on(event, listener),
    close: () => {},
  };
}

/** Statuses are sent at most this often (the last one is always sent), so a busy lane costs the main thread little. */
export const STATUS_REPORT_INTERVAL_MS = 1_000;

/**
 * Serves the parent from inside a lane process: reports status (with the thread's metrics) after
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
        // The process ends either way; the parent ends it after `stopped`.
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

/**
 * A lane process lives only as long as its parent's channel: never an orphan lane holding connections
 * beside the parent's next one. Ctrl-C and similar signals reach the whole process group; the parent
 * handles them by stopping the lane, so this process leaves them to it.
 */
export function exitWithParent(proc: NodeJS.Process = process): void {
  proc.on('disconnect', () => proc.exit(0));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) proc.on(signal, () => {});
  if (!proc.connected) proc.exit(0);
}
