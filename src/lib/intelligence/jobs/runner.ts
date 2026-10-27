import 'server-only';
import { logger } from '@/lib/logger';
import { getIntelligenceSettings, type IntelligenceSettingsView } from '../settings/service';
import { evaluatePause, getCriticalBacklogLagMs, type PauseState } from './backpressure';
import { withDbBudget } from './db-budget';
import { discoverNewIncidents, reconcileFingerprints } from './discovery';
import { indexIncident } from './indexer';
import { analyzeIncident } from '../similarity/analyzer';
import {
  claimWorkItems,
  completeWorkItem,
  enqueueWorkItems,
  failWorkItem,
  WORK_KINDS,
  type ClaimedWorkItem,
  type WorkKind,
} from './work-queue';

/** Periodic repair sweeps look only at recent incidents; deep history is an explicit backfill. */
export const RECONCILE_LOOKBACK_DAYS = 7;
const RECONCILE_INTERVAL_MS = 60_000;
const DISCOVERY_BATCH_MULTIPLIER = 5;

export interface HandlerContext {
  settings: IntelligenceSettingsView;
  signal: AbortSignal;
}
export type WorkHandler = (item: ClaimedWorkItem, context: HandlerContext) => Promise<void>;
export type WorkHandlers = Partial<Record<WorkKind, WorkHandler>>;

export const DEFAULT_HANDLERS: WorkHandlers = {
  [WORK_KINDS.INDEX_INCIDENT]: async (item, { settings }) => {
    const outcome = await withDbBudget(settings, tx => indexIncident(item.subjectKey, tx));
    // Analysis always follows a fresh fingerprint; coalescing keeps this to one item per incident.
    if (outcome === 'indexed') {
      await enqueueWorkItems([{ kind: WORK_KINDS.ANALYZE_INCIDENT, subjectKey: item.subjectKey }]);
    }
  },
  [WORK_KINDS.ANALYZE_INCIDENT]: async (item, { settings }) => {
    await analyzeIncident(item, settings);
  },
};

export interface LaneState {
  pause: PauseState;
  lastReconcileAt: number;
}

export function createLaneState(): LaneState {
  return { pause: { paused: false }, lastReconcileAt: 0 };
}

export interface CycleResult {
  status: 'disabled' | 'paused' | 'idle' | 'worked';
  criticalLagMs: number;
  discovered: number;
  claimed: number;
  completed: number;
  requeued: number;
  failed: number;
}

const EMPTY_RESULT: CycleResult = {
  status: 'disabled',
  criticalLagMs: 0,
  discovered: 0,
  claimed: 0,
  completed: 0,
  requeued: 0,
  failed: 0,
};

export interface CycleDependencies {
  handlers?: WorkHandlers;
  now?: () => number;
  getCriticalLagMs?: () => Promise<number>;
}

class WorkTimeoutError extends Error {
  constructor(ms: number) {
    super(`Intelligence work exceeded its ${ms}ms budget`);
    this.name = 'WorkTimeoutError';
  }
}

async function runWithTimeout(
  work: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new WorkTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    await Promise.race([work(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function processItem(
  item: ClaimedWorkItem,
  settings: IntelligenceSettingsView,
  handlers: WorkHandlers
): Promise<'completed' | 'requeued' | 'failed'> {
  try {
    const handler = handlers[item.kind as WorkKind];
    if (!handler) throw new Error(`No handler registered for work kind ${item.kind}`);
    await runWithTimeout(signal => handler(item, { settings, signal }), settings.maxJobMs);
    return (await completeWorkItem(item)) === 'requeued' ? 'requeued' : 'completed';
  } catch (error) {
    await failWorkItem(item, error).catch(releaseError =>
      logger.warn('[Intelligence] Failed to release work item after error', {
        id: item.id,
        error: releaseError instanceof Error ? releaseError.message : String(releaseError),
      })
    );
    return 'failed';
  }
}

/** Processes `items` with bounded concurrency; one failing item never affects the others. */
async function processBatch(
  items: ClaimedWorkItem[],
  settings: IntelligenceSettingsView,
  handlers: WorkHandlers
) {
  const counts = { completed: 0, requeued: 0, failed: 0 };
  let next = 0;
  const workers = Array.from({ length: Math.min(settings.maxConcurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      counts[await processItem(item, settings, handlers)] += 1;
    }
  });
  await Promise.all(workers);
  return counts;
}

/**
 * One bounded pass of the intelligence lane. It never throws: every failure is contained so
 * intelligence can degrade or stop without affecting ingestion, escalation or notifications.
 */
export async function runIntelligenceCycle(
  state: LaneState,
  dependencies: CycleDependencies = {}
): Promise<CycleResult> {
  const handlers = dependencies.handlers ?? DEFAULT_HANDLERS;
  const now = dependencies.now ?? Date.now;
  try {
    const settings = await getIntelligenceSettings();
    if (!settings.enabled) return { ...EMPTY_RESULT, status: 'disabled' };

    const criticalLagMs = await (dependencies.getCriticalLagMs ?? (() => getCriticalBacklogLagMs()))();
    const pause = evaluatePause(state.pause, criticalLagMs, settings.backpressureEscalationLagMs);
    state.pause = { paused: pause.paused };
    if (pause.changed) {
      logger.warn(
        pause.paused
          ? '[Intelligence] Pausing: critical job backlog exceeded threshold'
          : '[Intelligence] Resuming: critical job backlog recovered',
        { criticalLagMs, thresholdMs: settings.backpressureEscalationLagMs }
      );
    }
    if (pause.paused) return { ...EMPTY_RESULT, status: 'paused', criticalLagMs };

    let discovered = 0;
    try {
      const discovery = await discoverNewIncidents({
        limit: settings.batchSize * DISCOVERY_BATCH_MULTIPLIER,
        now: new Date(now()),
      });
      discovered = discovery.discovered;
      if (now() - state.lastReconcileAt >= RECONCILE_INTERVAL_MS) {
        state.lastReconcileAt = now();
        const repaired = await reconcileFingerprints({
          limit: settings.batchSize,
          lookbackDays: Math.min(settings.lookbackDays, RECONCILE_LOOKBACK_DAYS),
          now: new Date(now()),
        });
        discovered += repaired.missing + repaired.staleResolution;
      }
    } catch (error) {
      logger.warn('[Intelligence] Discovery failed; continuing with queued work', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const claimed = await claimWorkItems({ limit: settings.batchSize, leaseMs: settings.maxJobMs * 2 });
    if (claimed.length === 0) {
      return { ...EMPTY_RESULT, status: discovered > 0 ? 'worked' : 'idle', criticalLagMs, discovered };
    }
    const counts = await processBatch(claimed, settings, handlers);
    return { status: 'worked', criticalLagMs, discovered, claimed: claimed.length, ...counts };
  } catch (error) {
    logger.warn('[Intelligence] Cycle failed; will retry', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...EMPTY_RESULT, status: 'idle' };
  }
}

export interface LaneStatus {
  running: boolean;
  lastCycleAt: Date | null;
  lastResult: CycleResult | null;
  paused: boolean;
}

const lane: {
  timer: ReturnType<typeof setTimeout> | null;
  active: Promise<void> | null;
  running: boolean;
  state: LaneState;
  lastCycleAt: Date | null;
  lastResult: CycleResult | null;
} = {
  timer: null,
  active: null,
  running: false,
  state: createLaneState(),
  lastCycleAt: null,
  lastResult: null,
};

const IDLE_POLL_MS = 5_000;
const BUSY_POLL_MS = 250;

function jittered(ms: number): number {
  return ms + Math.floor(Math.random() * Math.max(1, ms / 4));
}

function schedule(delayMs: number) {
  if (!lane.running) return;
  lane.timer = setTimeout(() => {
    lane.timer = null;
    lane.active = runIntelligenceCycle(lane.state)
      .then(result => {
        lane.lastCycleAt = new Date();
        lane.lastResult = result;
        schedule(jittered(result.status === 'worked' ? BUSY_POLL_MS : IDLE_POLL_MS));
      })
      .finally(() => {
        lane.active = null;
      });
  }, delayMs);
}

/** Idempotent: starting an already-running lane is a no-op. */
export function startIntelligenceLane(): void {
  if (lane.running) return;
  lane.running = true;
  schedule(jittered(IDLE_POLL_MS));
}

/** Stops scheduling and waits for the in-flight cycle so shutdown never abandons claimed work. */
export async function stopIntelligenceLane(): Promise<void> {
  lane.running = false;
  if (lane.timer) clearTimeout(lane.timer);
  lane.timer = null;
  await lane.active;
}

export function getIntelligenceLaneStatus(): LaneStatus {
  return {
    running: lane.running,
    lastCycleAt: lane.lastCycleAt,
    lastResult: lane.lastResult,
    paused: lane.state.pause.paused,
  };
}
