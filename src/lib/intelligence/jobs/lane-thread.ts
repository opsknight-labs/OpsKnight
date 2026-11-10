import 'server-only';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { shareIngestionActivity } from '@/lib/ingestion/activity';
import { logger } from '@/lib/logger';
import {
  mergeRuntimeOperationalMetricState,
  type RuntimeOperationalMetricState,
} from '@/lib/metrics/operational/registry';
import { intelligenceLaneThreadEnv, intelligenceLaneThreadMode } from '@/lib/prisma-datasource';
import { getPrismaPoolWaitCount } from '@/lib/prisma-pool-pressure';
import {
  createPoolWaitingBuffer,
  writePoolWaiting,
  type LaneThreadCommand,
  type LaneThreadData,
  type LaneThreadReport,
} from './lane-thread-channel';
import type { LaneStatus, LaneThreadStatus, LaneTotals } from './runner';

/**
 * Runs the intelligence lane of an `integrated` process in a worker thread.
 *
 * In `integrated` the lane shares a process with ingestion. Measured in the ingestion A/B benchmark, the
 * lane's cost there was not its JavaScript but what it shares with `processEvent` on one thread: Prisma
 * response parsing, allocation and the garbage collection pauses they cause, which stop every in-flight
 * event (plans/intelligence-engine/certification/perf/README.md). A worker thread has its own V8 heap,
 * event loop and Prisma client, so none of that lands on the ingestion thread.
 *
 * The thread runs the same lane (wake listener, scheduler, handlers, abort budgets, generation fencing,
 * quarantine, backpressure). It reads the main thread's ingestion activity and pool pressure through
 * shared memory, so it yields to ingestion as an in-process lane does, and reports its status and metrics
 * by message, so health and /metrics are unchanged. A thread that exits unexpectedly is restarted with
 * backoff; claimed work it held is re-claimed after its lease, as after a process crash.
 *
 * Dedicated `intelligence-worker` processes, and the `worker`/`general-worker` roles, are unaffected: only
 * `integrated` uses a thread. `INTELLIGENCE_LANE_THREAD=off` keeps the lane on the main thread, and so does
 * a build without the thread bundle (for example `next dev` before any `npm run build`). That fallback is
 * outside the ingestion latency contract; instrumentation.ts warns about it and health and /metrics show it.
 *
 * With a stand-in (how instrumentation.ts starts it) no thread exists while intelligence is disabled:
 * a second heap, Prisma engine and pool are not spent on a feature that is off. The disabled lane idles on
 * the main thread as it did before the thread existed (one settings row per poll, the disabled-time
 * sweeps) and hands off to a thread on the first cycle that reads settings as enabled; a thread that
 * reports a disabled cycle is stopped and the lane is parked on the main thread again.
 */

/**
 * Built by scripts/build-intelligence-lane-thread.mjs, which `npm run build` (postbuild), `npm start`
 * (prestart, only when missing) and `npm run build:scripts` (the Docker image) all run.
 */
export const LANE_THREAD_BUNDLE = join('scripts', 'dist', 'intelligence-lane-thread.cjs');
const RESTART_MIN_MS = 1_000;
const RESTART_MAX_MS = 60_000;
/** A thread that ran this long before exiting is restarted after the shortest delay again. */
const RESTART_RESET_AFTER_MS = 5 * 60_000;
/** Stopping waits this long for the thread to finish its in-flight cycle before terminating it. */
const DEFAULT_STOP_TIMEOUT_MS = 30_000;
const POOL_SAMPLE_MS = 1_000;

export type LaneThreadMode = 'auto' | 'off';

export function laneThreadMode(value?: string): LaneThreadMode {
  return value === undefined ? intelligenceLaneThreadMode() : intelligenceLaneThreadMode(value);
}

/** Only `integrated` moves the lane into a thread; every other role keeps its lane as it was. */
export function shouldRunLaneInThread(
  role: string,
  mode: LaneThreadMode = laneThreadMode()
): boolean {
  return role === 'integrated' && mode !== 'off';
}

/** The bundled thread entry, or null when this build has none (the lane then stays on the main thread). */
export function resolveLaneThreadEntry(
  cwd: string = process.cwd(),
  exists: (path: string) => boolean = existsSync
): string | null {
  for (const root of laneThreadAppRoots(cwd)) {
    const bundled = join(root, LANE_THREAD_BUNDLE);
    if (exists(bundled)) return bundled;
  }
  return null;
}

/**
 * Where the app root can be, relative to the working directory. `next dev`, `next start` and the Docker
 * image (which copies the standalone output and scripts/dist into one directory) run from the app root.
 * `node .next/standalone/server.js` in a source checkout changes into `.next/standalone`, two levels below
 * it; a bundle copied into the standalone directory wins, then the checkout's own.
 */
export function laneThreadAppRoots(cwd: string): string[] {
  const roots = [cwd];
  if (basename(cwd) === 'standalone' && basename(dirname(cwd)) === '.next')
    roots.push(dirname(dirname(cwd)));
  return roots;
}

export interface IntegratedLanePlan {
  mode: 'thread' | 'in-process';
  /** Why `integrated` cannot use the thread; null for every other role and for the thread itself. */
  fallbackReason: 'bundle-missing' | 'disabled-by-env' | null;
  /** What an operator does about the fallback (fixed text, safe to log). */
  remedy: string;
}

export const LANE_FALLBACK_REMEDY = {
  'bundle-missing':
    'The thread bundle scripts/dist/intelligence-lane-thread.cjs was not found: run `npm run build` ' +
    '(or `npm run build:scripts`) and restart, or run a dedicated intelligence-worker.',
  'disabled-by-env':
    'INTELLIGENCE_LANE_THREAD=off is set: remove it and restart, or run a dedicated intelligence-worker.',
} as const;

/** Decides once, at startup, where the lane of this process runs and why. */
export function planIntegratedLane(
  role: string,
  mode: LaneThreadMode = laneThreadMode(),
  entry: string | null = resolveLaneThreadEntry()
): IntegratedLanePlan {
  if (role !== 'integrated') return { mode: 'in-process', fallbackReason: null, remedy: '' };
  const fallbackReason = mode === 'off' ? 'disabled-by-env' : entry ? null : 'bundle-missing';
  if (!fallbackReason) return { mode: 'thread', fallbackReason: null, remedy: '' };
  return {
    mode: 'in-process',
    fallbackReason,
    remedy:
      fallbackReason === 'disabled-by-env'
        ? LANE_FALLBACK_REMEDY['disabled-by-env']
        : LANE_FALLBACK_REMEDY['bundle-missing'],
  };
}

export function restartDelayMs(consecutiveFailures: number): number {
  return Math.min(RESTART_MAX_MS, RESTART_MIN_MS * 2 ** Math.max(0, consecutiveFailures - 1));
}

export interface LaneThreadOptions {
  /** Entry file of the thread; defaults to the bundle. Benchmarks and tests pass their own. */
  entry?: string;
  /** Extra worker data for a custom entry (merged with the shared buffers). */
  workerData?: Record<string, unknown>;
  /** Messages other than the lane protocol, for a custom entry. */
  onMessage?: (message: unknown) => void;
  stopTimeoutMs?: number;
  restartDelayMs?: (consecutiveFailures: number) => number;
  /** How the main pool's waiting-query count is read (default: this process's Prisma metrics). */
  poolWaitingQueries?: () => Promise<number | null>;
  poolSampleMs?: number;
  /**
   * With a stand-in, a thread exists only while intelligence is enabled: until then (and again after it
   * is disabled) the stand-in, the disabled lane on the main thread, idles in its place. Without one the
   * thread starts at once (benchmarks, tests). See lane-stand-in.ts for the real one.
   */
  standIn?: LaneStandIn;
}

export interface LaneStandIn {
  /** Starts the lane on this thread; it must call `handOff` instead of working once enabled. */
  start: (handOff: () => void) => void;
  stop: () => Promise<void>;
  status: () => LaneStatus;
}

interface HostState {
  running: boolean;
  options: LaneThreadOptions;
  entry: string;
  data: LaneThreadData | null;
  worker: Worker | null;
  exited: Promise<void> | null;
  stoppedByRequest: boolean;
  thread: LaneThreadStatus;
  laneStartedAt: Date | null;
  threadStartedAt: number;
  consecutiveFailures: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  poolTimer: ReturnType<typeof setInterval> | null;
  lastStatus: LaneStatus | null;
  lastMetrics: RuntimeOperationalMetricState | null;
  /** Totals of threads that already exited, so restarts never reset the cumulative counts. */
  carried: LaneTotals;
  /** True while the disabled lane stands in on the main thread and no thread exists. */
  parked: boolean;
  /** True while a thread that reported `disabled` is being stopped to park the lane. */
  parking: boolean;
  /** The move between the main thread and a lane thread in progress, if any. */
  moving: Promise<void> | null;
}

const ZERO_TOTALS: LaneTotals = {
  cycles: 0,
  claimed: 0,
  completed: 0,
  requeued: 0,
  failed: 0,
  lost: 0,
};

let host: HostState | null = null;

function addTotals(left: LaneTotals, right: LaneTotals | undefined): LaneTotals {
  if (!right) return { ...left };
  return {
    cycles: left.cycles + right.cycles,
    claimed: left.claimed + right.claimed,
    completed: left.completed + right.completed,
    requeued: left.requeued + right.requeued,
    failed: left.failed + right.failed,
    lost: left.lost + right.lost,
  };
}

/** The lane as the rest of the process sees it: the thread's last report plus the thread's own state. */
function statusOf(state: HostState): LaneStatus {
  // Parked: the disabled lane on this thread is the lane; only the thread's cumulative totals carry over.
  if (state.parked) {
    const local = state.options.standIn!.status();
    return {
      ...local,
      running: state.running,
      startedAt: state.laneStartedAt,
      totals: addTotals(state.carried, local.totals),
      thread: { ...state.thread },
    };
  }
  const last = state.lastStatus;
  return {
    running: state.running,
    startedAt: state.laneStartedAt,
    lastCycleAt: last?.lastCycleAt ?? null,
    lastResult: last?.lastResult ?? null,
    paused: last?.paused ?? false,
    poolWaitingQueries: last?.poolWaitingQueries ?? null,
    pauseReason: last?.pauseReason ?? null,
    timedOutInFlight: state.worker ? (last?.timedOutInFlight ?? 0) : 0,
    saturated: last?.saturated ?? false,
    pausedKinds: last?.pausedKinds ?? [],
    yieldingToIngestion: last?.yieldingToIngestion ?? false,
    wakeLeader: state.worker ? (last?.wakeLeader ?? null) : null,
    // Cycles the parked lane ran on this thread (cumulative for the process) count too.
    totals: addTotals(
      addTotals(state.carried, state.options.standIn?.status().totals),
      state.worker ? last?.totals : undefined
    ),
    thread: { ...state.thread },
  };
}

function handleReport(state: HostState, worker: Worker, message: unknown) {
  if (state.worker !== worker) return;
  const report = message as LaneThreadReport | null;
  if (report?.type === 'status') {
    state.lastStatus = report.status;
    try {
      mergeRuntimeOperationalMetricState(state.lastMetrics, report.metrics);
    } catch {
      // Metrics are best effort.
    }
    state.lastMetrics = report.metrics;
    if (state.thread.state === 'starting') state.thread.state = 'running';
    // Intelligence was disabled while the thread ran: stop the thread and park the lane on this thread.
    if (
      state.options.standIn &&
      state.running &&
      !state.parking &&
      report.status.lastResult?.status === 'disabled'
    ) {
      state.parking = true;
      worker.postMessage({ type: 'stop' } satisfies LaneThreadCommand);
      const timer = setTimeout(
        () => void worker.terminate(),
        state.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
      );
      timer.unref?.();
      worker.once('exit', () => clearTimeout(timer));
    }
    return;
  }
  if (report?.type === 'stopped') {
    // The lane has stopped and its pool is closed; nothing a module timer still holds is worth waiting for.
    void worker.terminate();
    return;
  }
  state.options.onMessage?.(message);
}

function spawn(state: HostState) {
  state.restartTimer = null;
  if (!state.running || !state.data) return;
  let worker: Worker;
  try {
    worker = new Worker(state.entry, {
      name: 'opsknight-intelligence-lane',
      workerData: { ...state.options.workerData, ...state.data },
      env: intelligenceLaneThreadEnv(),
    });
  } catch (error) {
    failed(state, null, 'Lane thread could not be created', error);
    return;
  }
  state.worker = worker;
  state.lastStatus = null;
  state.lastMetrics = null;
  state.threadStartedAt = Date.now();
  state.thread.state = 'starting';
  state.thread.startedAt = new Date(state.threadStartedAt);
  let thrown: unknown = null;
  worker.on('message', message => handleReport(state, worker, message));
  worker.on('error', error => {
    thrown = error;
  });
  state.exited = new Promise<void>(resolve => {
    worker.once('exit', code => {
      resolve();
      if (state.worker !== worker) return;
      // Totals of the thread that ended carry over to the next one.
      state.carried = addTotals(state.carried, state.lastStatus?.totals);
      state.lastStatus = state.lastStatus
        ? { ...state.lastStatus, totals: { ...ZERO_TOTALS } }
        : null;
      state.worker = null;
      if (state.stoppedByRequest || !state.running) return;
      if (state.parking) {
        state.parking = false;
        park(state);
        return;
      }
      failed(
        state,
        worker,
        thrown
          ? 'Lane thread failed with an uncaught error'
          : `Lane thread exited with code ${code}`,
        thrown
      );
    });
  });
}

function failed(state: HostState, worker: Worker | null, description: string, error: unknown) {
  if (worker && Date.now() - state.threadStartedAt >= RESTART_RESET_AFTER_MS)
    state.consecutiveFailures = 0;
  state.consecutiveFailures += 1;
  state.thread.restarts += 1;
  state.thread.lastExit = description;
  state.thread.state = 'restarting';
  const delay = (state.options.restartDelayMs ?? restartDelayMs)(state.consecutiveFailures);
  logger.error('[Intelligence] Lane thread stopped unexpectedly; restarting', {
    description,
    delayMs: delay,
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
  });
  state.restartTimer = setTimeout(() => spawn(state), delay);
  state.restartTimer.unref?.();
}

/** Runs the disabled lane on this thread until a cycle reads settings as enabled, then starts a thread. */
function park(state: HostState) {
  state.parked = true;
  state.thread.state = 'parked';
  state.thread.startedAt = null;
  state.lastStatus = null;
  state.lastMetrics = null;
  state.options.standIn!.start(() => {
    if (!state.parked || state.moving || !state.running) return;
    // Called from inside a cycle: stopping waits for that cycle, so it must not be awaited here.
    state.moving = (async () => {
      try {
        await state.options.standIn!.stop();
        state.parked = false;
        if (state.running) {
          logger.info('[Intelligence] Intelligence is enabled; starting the lane thread');
          spawn(state);
        }
      } catch (error) {
        logger.error('[Intelligence] Could not move the lane to its thread; retrying', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        state.moving = null;
      }
    })();
  });
}

/**
 * Starts the lane in a worker thread. Returns false (and starts nothing) when there is no thread entry,
 * so the caller can run the lane on the main thread instead. Idempotent while running.
 */
export function startIntelligenceLaneThread(options: LaneThreadOptions = {}): boolean {
  if (host?.running) return true;
  const entry = options.entry ?? resolveLaneThreadEntry();
  if (!entry) return false;
  const poolWaiting = createPoolWaitingBuffer();
  const state: HostState = {
    running: true,
    options,
    entry,
    data: { activity: shareIngestionActivity(), poolWaiting },
    worker: null,
    exited: null,
    stoppedByRequest: false,
    thread: { state: 'starting', restarts: 0, startedAt: null, lastExit: null },
    laneStartedAt: new Date(),
    threadStartedAt: 0,
    consecutiveFailures: 0,
    restartTimer: null,
    poolTimer: null,
    lastStatus: null,
    lastMetrics: null,
    carried: { ...ZERO_TOTALS },
    parked: false,
    parking: false,
    moving: null,
  };
  host = state;
  // The lane protects the pool ingestion uses: publish its waiting-query count for the thread to read.
  // One engine-local metrics read per second; it never borrows a connection.
  const readPool = options.poolWaitingQueries ?? (() => getPrismaPoolWaitCount());
  let sampling = false;
  state.poolTimer = setInterval(() => {
    if (sampling) return;
    sampling = true;
    void readPool()
      .catch(() => null)
      .then(waiting => writePoolWaiting(poolWaiting, waiting))
      .finally(() => {
        sampling = false;
      });
  }, options.poolSampleMs ?? POOL_SAMPLE_MS);
  state.poolTimer.unref?.();
  globalThis.opsKnightIntelligenceLaneStatusSource = () => statusOf(state);
  if (options.standIn) {
    park(state);
    logger.info('[Intelligence] Lane thread starts when intelligence is enabled', { entry });
  } else {
    spawn(state);
    logger.info('[Intelligence] Lane started in a worker thread', { entry });
  }
  return true;
}

/**
 * Stops the lane: the thread stops scheduling, waits for its in-flight cycle (abortable handlers end
 * promptly), disconnects its pool and exits. A thread that does not exit in time is terminated; any item
 * it still held is re-claimed after its lease.
 */
export async function stopIntelligenceLaneThread(): Promise<void> {
  const state = host;
  if (!state) return;
  state.running = false;
  state.stoppedByRequest = true;
  if (state.restartTimer) clearTimeout(state.restartTimer);
  state.restartTimer = null;
  if (state.poolTimer) clearInterval(state.poolTimer);
  state.poolTimer = null;
  await state.moving;
  if (state.parked) {
    await state.options.standIn!.stop().catch(() => {});
    state.parked = false;
  }
  const worker = state.worker;
  if (worker) {
    state.thread.state = 'stopping';
    worker.postMessage({ type: 'stop' } satisfies LaneThreadCommand);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      state.exited!.then(() => false),
      new Promise<boolean>(resolve => {
        timer = setTimeout(
          () => resolve(true),
          state.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
        );
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (timedOut) {
      logger.warn('[Intelligence] Lane thread did not stop in time; terminating it');
      await worker.terminate();
      await state.exited;
    }
  }
  state.thread.state = 'stopped';
}

/** Whether a lane thread is running in this process (for tests and diagnostics). */
export function laneThreadWorker(): Worker | null {
  return host?.worker ?? null;
}
