import 'server-only';
import { logger } from '@/lib/logger';
import { getIntelligenceSettings, type IntelligenceSettingsView } from '../settings/service';
import { evaluatePause, getCriticalBacklogLagMs, type PauseState } from './backpressure';
import { withDbBudget } from './db-budget';
import { reconcileFingerprints, discoverNewIncidents } from './discovery';
import { indexIncident } from './indexer';
import { purgeExpiredIntelligenceData, RETENTION_INTERVAL_MS } from './retention';
import { analyzeIncident } from '../similarity/analyzer';
import { correlateIncident, shouldCorrelate } from '../correlation/handler';
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
    // Correlation is chained only when the effective policy has rules, so installs without rules
    // pay no extra write per incident.
    if (outcome === 'indexed') {
      const next: Array<{ kind: WorkKind; subjectKey: string }> = [
        { kind: WORK_KINDS.ANALYZE_INCIDENT, subjectKey: item.subjectKey },
      ];
      if (await shouldCorrelate(item.subjectKey)) {
        next.push({ kind: WORK_KINDS.CORRELATE_INCIDENT, subjectKey: item.subjectKey });
      }
      await enqueueWorkItems(next);
    }
  },
  [WORK_KINDS.CORRELATE_INCIDENT]: async (item, { settings }) => {
    await correlateIncident(item, settings);
  },
  [WORK_KINDS.ANALYZE_INCIDENT]: async (item, { settings }) => {
    await analyzeIncident(item, settings);
  },
};

export interface LaneState {
  pause: PauseState;
  lastReconcileAt: number;
  lastRetentionAt: number;
}

export function createLaneState(): LaneState {
  return { pause: { paused: false }, lastReconcileAt: 0, lastRetentionAt: 0 };
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

    // Retention is honoured even while intelligence is switched off; an unconfigured install
    // (revision 0) has nothing to purge, so it pays no cost.
    if (settings.revision > 0 && now() - state.lastRetentionAt >= RETENTION_INTERVAL_MS) {
      state.lastRetentionAt = now();
      try {
        const purged = await purgeExpiredIntelligenceData(settings, {
          batchSize: Math.max(settings.batchSize * 10, 100),
          now: new Date(now()),
        });
        // A large backlog is drained across sweeps; ask for the next one soon instead of waiting.
        if (purged.more) state.lastRetentionAt = now() - RETENTION_INTERVAL_MS + 60_000;
      } catch (error) {
        logger.warn('[Intelligence] Retention sweep failed; will retry', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

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

export interface LaneTotals {
  cycles: number;
  claimed: number;
  completed: number;
  requeued: number;
  failed: number;
}

export interface LaneStatus {
  running: boolean;
  lastCycleAt: Date | null;
  lastResult: CycleResult | null;
  paused: boolean;
  /** Cumulative since process start; lets operators and benchmarks see real throughput. */
  totals: LaneTotals;
}

const lane: {
  timer: ReturnType<typeof setTimeout> | null;
  active: Promise<void> | null;
  running: boolean;
  state: LaneState;
  lastCycleAt: Date | null;
  lastResult: CycleResult | null;
  totals: LaneTotals;
} = {
  timer: null,
  active: null,
  running: false,
  state: createLaneState(),
  lastCycleAt: null,
  lastResult: null,
  totals: { cycles: 0, claimed: 0, completed: 0, requeued: 0, failed: 0 },
};

const IDLE_POLL_MS = 5_000;
const BUSY_POLL_MS = 250;
/** While disabled the lane only re-reads one settings row, so it polls slowly. */
const DISABLED_POLL_MS = 30_000;

/**
 * Roles that host the lane. It shares the general worker's place in the topology; a dedicated
 * `intelligence-worker` role is a separate, optional deployment decision.
 */
const LANE_ROLES: ReadonlySet<string> = new Set(['integrated', 'worker', 'general-worker']);

export function shouldRunIntelligenceLane(role: string): boolean {
  return LANE_ROLES.has(role);
}

function nextDelayMs(result: CycleResult): number {
  if (result.status === 'worked') return BUSY_POLL_MS;
  return result.status === 'disabled' ? DISABLED_POLL_MS : IDLE_POLL_MS;
}

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
        lane.totals.cycles += 1;
        lane.totals.claimed += result.claimed;
        lane.totals.completed += result.completed;
        lane.totals.requeued += result.requeued;
        lane.totals.failed += result.failed;
        schedule(jittered(nextDelayMs(result)));
      })
      .finally(() => {
        lane.active = null;
      });
  }, delayMs);
}

/** Idempotent: starting an already-running lane is a no-op. `initialDelayMs` exists for benchmarks. */
export function startIntelligenceLane(options: { initialDelayMs?: number } = {}): void {
  if (lane.running) return;
  lane.running = true;
  schedule(jittered(options.initialDelayMs ?? IDLE_POLL_MS));
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
    totals: { ...lane.totals },
  };
}
