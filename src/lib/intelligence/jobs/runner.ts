import 'server-only';
import { isIntelligenceDedicatedProcess } from '@/lib/runtime-role';
import { encodeWorkFailure } from './failures';
import { logger } from '@/lib/logger';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import { withSpan } from '../telemetry';
import {
  getIntelligenceSettings,
  resolveEffectivePolicy,
  withIntelligenceReadMemo,
  type IntelligenceSettingsView,
} from '../settings/service';
import { evaluateLanePause, getCriticalBacklogLagMs, type PauseState } from './backpressure';
import { getPrismaPoolWaitCount } from '@/lib/prisma-pool-pressure';
import { withAbortableDbWork, withDbBudget } from './db-budget';
import {
  discoverNewIncidents,
  reconcileFingerprints,
  reconcileUpdatedIncidents,
} from './discovery';
import { indexIncident } from './indexer';
import { KindBreaker } from './kind-breaker';
import { listenForIntelligenceWake } from './wake-listener';
import { purgeExpiredIntelligenceData, RETENTION_INTERVAL_MS } from './retention';
import { analyzeIncident } from '../similarity/analyzer';
import { correlateIncident } from '../correlation/handler';
import { OBSERVE_INTERVAL_MS, observeDependencyPass } from '../dependencies/observer';
import { analyzeResponse } from '../response/handler';
import { reanalyzeAfterLateChange } from '../changes/service';
import { computeChangeRisk } from '../changes/risk';
import { predictTriage } from '../triage/predict';
import {
  scheduleTopologySyncsIfDue,
  syncTopologySource,
  TOPOLOGY_SYNC_CHECK_INTERVAL_MS,
} from '../dependencies/topology-sources';
import { purgeConversations } from '../conversations/store';
import { AiGatewayError } from '../ai/gateway';
import { DIGEST_CHECK_INTERVAL_MS, scheduleDigestIfDue, sendDigestPass } from '../digest/service';
import {
  currentEmbeddingModel,
  embedIncidents,
  EMBED_BATCH_SIZE,
  EMBED_INTERVAL_MS,
  findIncidentsToEmbedPage,
} from '../semantic/embedder';
import {
  claimWorkItems,
  completeWorkItem,
  enqueueWorkItems,
  failWorkItem,
  renewWorkItemLease,
  WORK_KINDS,
  FIRST_INSIGHT_INDEX_PRIORITY,
  type ClaimedWorkItem,
  type WorkKind,
} from './work-queue';

/** Periodic repair sweeps look only at recent incidents; deep history is an explicit backfill. */
export const RECONCILE_LOOKBACK_DAYS = 7;
/**
 * The recent-history sweep repairs engine-version and placeholder drift and is paced slowly. Ordinary
 * changes whose wake hint was lost are caught by the per-cycle updated-incident sweep, in O(changes).
 */
export const RECONCILE_INTERVAL_MS = 10 * 60_000;
const DISCOVERY_BATCH_MULTIPLIER = 5;
const DEPENDENCY_OBSERVER_SUBJECT = 'dependency-observation';
/** Retention batches shrink while a table keeps timing out and grow back once sweeps are clean. */
const RETENTION_MIN_BATCH = 10;

export interface HandlerContext {
  settings: IntelligenceSettingsView;
  signal: AbortSignal;
}
export type WorkHandler = (item: ClaimedWorkItem, context: HandlerContext) => Promise<void>;
export type WorkHandlers = Partial<Record<WorkKind, WorkHandler>>;

export const DEFAULT_HANDLERS: WorkHandlers = {
  // A pass skipped because another replica holds the observer lock is simply not this replica's work;
  // the hourly schedule enqueues the next one, so the lock is never spun on.
  [WORK_KINDS.OBSERVE_DEPENDENCIES]: async (_item, { settings }) => {
    const pass = await observeDependencyPass(settings);
    if (pass.more && !pass.skipped)
      await enqueueWorkItems([
        { kind: WORK_KINDS.OBSERVE_DEPENDENCIES, subjectKey: DEPENDENCY_OBSERVER_SUBJECT },
      ]);
  },
  // The fingerprint and the follow-up work are written in one transaction, so a crash can never leave a
  // fingerprint that is never analysed. With the effective policy OFF only an empty placeholder is stored:
  // no text is kept and nothing follows, and reconciliation re-checks it once the policy changes. A very
  // large incident is bootstrapped over several bounded passes: each pass re-signals its own item.
  [WORK_KINDS.INDEX_INCIDENT]: async (item, { settings }) => {
    await withDbBudget(settings, async tx => {
      const incident = await tx.incident.findUnique({
        where: { id: item.subjectKey },
        select: { serviceId: true },
      });
      if (!incident) return;
      const policy = await resolveEffectivePolicy(incident.serviceId);
      const active = policy.effectiveMode !== 'OFF';
      const outcome = await indexIncident(item.subjectKey, tx, {
        suppressed: !active,
        force: item.force,
        policy: { id: policy.policyId, version: policy.version, mode: policy.effectiveMode },
      });
      if (outcome === 'partial') {
        await enqueueWorkItems(
          [{ kind: WORK_KINDS.INDEX_INCIDENT, subjectKey: item.subjectKey }],
          tx
        );
        return;
      }
      if (outcome !== 'indexed' || !active) return;
      // Correlation and response analysis are chained only when the policy uses them, so installs
      // without rules pay no extra write per incident.
      const next: Array<{ kind: WorkKind; subjectKey: string }> = [
        { kind: WORK_KINDS.ANALYZE_INCIDENT, subjectKey: item.subjectKey },
      ];
      if (policy.policyId && policy.definition.correlation.rules.some(rule => rule.enabled)) {
        next.push({ kind: WORK_KINDS.CORRELATE_INCIDENT, subjectKey: item.subjectKey });
      }
      if (policy.definition.response.enabled) {
        next.push({ kind: WORK_KINDS.ANALYZE_RESPONSE, subjectKey: item.subjectKey });
      }
      await enqueueWorkItems(next, tx);
    });
  },
  [WORK_KINDS.CORRELATE_INCIDENT]: async (item, { settings }) => {
    await correlateIncident(item, settings);
  },
  [WORK_KINDS.ANALYZE_RESPONSE]: async (item, { settings }) => {
    await analyzeResponse(item, settings);
  },
  [WORK_KINDS.ANALYZE_INCIDENT]: async (item, { settings }) => {
    await analyzeIncident(item, settings);
  },
  // A change that arrived after the incidents it may explain: the webhook only records it, and this
  // bounded pass scores its risk and fans out the re-analysis in the lane instead of in the request.
  [WORK_KINDS.LATE_CHANGE]: async (item, { settings }) => {
    await withDbBudget(settings, async tx => {
      const change = await tx.changeEvent.findUnique({
        where: { id: item.subjectKey },
        select: { serviceId: true, occurredAt: true },
      });
      if (!change) return;
      await computeChangeRisk(tx, item.subjectKey);
      await reanalyzeAfterLateChange(change.serviceId, change.occurredAt, tx);
    });
  },
  [WORK_KINDS.TRIAGE_INCIDENT]: async (item, { settings }) => {
    await predictTriage(item, settings);
  },
  [WORK_KINDS.SYNC_TOPOLOGY]: async (item, { settings, signal }) => {
    await syncTopologySource(item.subjectKey, settings, signal);
  },
  // Semantic search is optional and never sits in front of analysis: incidents are analysed lexically
  // straight away, then re-analysed once their vector exists, so a slow or failing embedding provider
  // only delays the semantic signal. One provider call per pass, however many incidents arrive.
  [WORK_KINDS.EMBED_PENDING]: async (_item, { signal }) => {
    const model = await currentEmbeddingModel();
    if (!model) return;
    const page = await findIncidentsToEmbedPage(model);
    const next: Array<{ kind: WorkKind; subjectKey: string }> = [];
    let embedded = 0;
    if (page.ids.length > 0) {
      let outcome: Awaited<ReturnType<typeof embedIncidents>>;
      try {
        outcome = await embedIncidents(page.ids, signal);
      } catch (error) {
        // Expected spend/rate pauses are rediscovered by the next scheduled pass. They must not
        // exhaust retries and quarantine a healthy backfill before the next UTC allowance opens.
        if (
          error instanceof AiGatewayError &&
          (error.code === 'BUDGET_EXHAUSTED' || error.code === 'RATE_LIMITED')
        )
          return;
        throw error;
      }
      if (outcome.status !== 'done') return;
      embedded = outcome.embedded.length;
      next.push(
        ...outcome.embedded.map(id => ({ kind: WORK_KINDS.ANALYZE_INCIDENT, subjectKey: id }))
      );
    }
    // Keep walking while the window has more pages, or while a full batch was just embedded.
    if (page.more || (page.ids.length >= EMBED_BATCH_SIZE && embedded > 0)) {
      next.push({ kind: WORK_KINDS.EMBED_PENDING, subjectKey: SEMANTIC_SUBJECT });
    }
    if (next.length) await enqueueWorkItems(next);
  },
  [WORK_KINDS.SEND_DIGEST]: async (item, { signal }) => {
    if ((await sendDigestPass(item.subjectKey, new Date(), signal)) === 'more') {
      await enqueueWorkItems([{ kind: WORK_KINDS.SEND_DIGEST, subjectKey: item.subjectKey }]);
    }
  },
};

const SEMANTIC_SUBJECT = 'pending';

/**
 * Work that waits on an external provider or mail hand-off needs longer than the per-item database budget.
 * Its lease is extended to cover the longer budget, so it is not re-claimed while still running.
 */
const KIND_MIN_BUDGET_MS: Partial<Record<WorkKind, number>> = {
  [WORK_KINDS.EMBED_PENDING]: 120_000,
  [WORK_KINDS.SEND_DIGEST]: 120_000,
};

export function workBudgetMs(
  kind: string,
  settings: Pick<IntelligenceSettingsView, 'maxJobMs'>
): number {
  return Math.max(settings.maxJobMs, KIND_MIN_BUDGET_MS[kind as WorkKind] ?? 0);
}

export interface LaneState {
  pause: PauseState;
  poolWaitingQueries?: number | null;
  lastReconcileAt: number;
  lastRetentionAt: number;
  lastObserveAt: number;
  lastEmbedAt: number;
  lastDigestCheckAt: number;
  lastConversationSweepAt: number;
  lastTopologyCheckAt: number;
  /** Handlers that exceeded their budget and are still running; they count against concurrency until they let go. */
  timedOut: Set<Promise<unknown>>;
  kinds: KindBreaker;
  saturatedLogged: boolean;
  /** Current retention batch size, adapted to how the last sweeps went; null until the first sweep. */
  retentionBatchSize: number | null;
}

export function createLaneState(): LaneState {
  return {
    pause: { paused: false },
    lastReconcileAt: 0,
    lastRetentionAt: 0,
    lastObserveAt: 0,
    lastEmbedAt: 0,
    lastDigestCheckAt: 0,
    lastConversationSweepAt: 0,
    lastTopologyCheckAt: 0,
    timedOut: new Set(),
    kinds: new KindBreaker(),
    saturatedLogged: false,
    retentionBatchSize: null,
  };
}

export interface CycleResult {
  status: 'disabled' | 'paused' | 'idle' | 'worked';
  criticalLagMs: number;
  /** New incidents found by the discovery watermark. */
  discovered: number;
  /** Existing incidents re-signalled by the anti-entropy sweeps (lost hints, drift, placeholders). */
  repaired: number;
  claimed: number;
  completed: number;
  requeued: number;
  failed: number;
  /** Finished, but the claim had expired and another worker owns the item now. */
  lost: number;
  /** Timed-out handlers still holding a connection at the end of this cycle. */
  timedOut: number;
  /** True when every concurrency slot was held by timed-out work, so nothing new was claimed. */
  saturated: boolean;
  pausedKinds: string[];
}

const EMPTY_RESULT: CycleResult = {
  status: 'disabled',
  criticalLagMs: 0,
  discovered: 0,
  repaired: 0,
  claimed: 0,
  completed: 0,
  requeued: 0,
  failed: 0,
  lost: 0,
  timedOut: 0,
  saturated: false,
  pausedKinds: [],
};

export interface CycleDependencies {
  handlers?: WorkHandlers;
  now?: () => number;
  getCriticalLagMs?: () => Promise<number>;
  getPoolWaitingQueries?: () => Promise<number | null>;
}

class WorkTimeoutError extends Error {
  constructor(ms: number) {
    super(`Intelligence work exceeded its ${ms}ms budget`);
    this.name = 'WorkTimeoutError';
  }
}

/**
 * Races the handler against its budget. Aborting cancels every budgeted statement the handler has open;
 * until the handler actually settles it stays in `state.timedOut`, where it keeps a concurrency slot, so
 * a batch can never run more database work than the operator allowed.
 */
async function runWithTimeout(
  work: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number,
  state: LaneState
): Promise<void> {
  const controller = new AbortController();
  const run = work(controller.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new WorkTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    await Promise.race([run, timeout]);
  } catch (error) {
    if (error instanceof WorkTimeoutError) {
      state.timedOut.add(run);
      run.catch(() => {}).finally(() => state.timedOut.delete(run));
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface BatchLease {
  claimedAt: number;
  leaseMs: number;
}

async function processItem(
  item: ClaimedWorkItem,
  settings: IntelligenceSettingsView,
  handlers: WorkHandlers,
  state: LaneState,
  lease: BatchLease
): Promise<'completed' | 'requeued' | 'failed' | 'lost'> {
  const startedAt = performance.now();
  const metricKind = Object.values(WORK_KINDS).includes(item.kind as WorkKind)
    ? item.kind
    : 'UNKNOWN';
  const budgetMs = workBudgetMs(item.kind, settings);
  try {
    const handler = handlers[item.kind as WorkKind];
    if (!handler) throw new Error(`No handler registered for work kind ${item.kind}`);
    // Items at the tail of a batch may start after half their lease is gone. Renewing first means a slow
    // batch never has the same item running here and on a worker that re-claimed it.
    const renew =
      budgetMs > settings.maxJobMs || performance.now() - lease.claimedAt > lease.leaseMs / 2;
    if (renew && !(await renewWorkItemLease(item, Math.max(budgetMs * 2, lease.leaseMs))))
      return 'lost';
    await withSpan(
      'intelligence.work',
      { 'work.kind': item.kind, 'work.attempt': item.attempts },
      () =>
        runWithTimeout(
          signal => withAbortableDbWork(signal, () => handler(item, { settings, signal })),
          budgetMs,
          state
        )
    );
    return completeWorkItem(item);
  } catch (error) {
    addOperationalMetric('opsknight_intelligence_work_failures_total', 1, { kind: metricKind });
    // A timed-out handler may still be inside a transaction; keep the item unclaimable until that
    // transaction's own hard timeout has passed, so a retry never runs alongside it.
    const minDelayMs = error instanceof WorkTimeoutError ? settings.maxDbMs + 5_000 : 0;
    await failWorkItem(item, error, undefined, undefined, minDelayMs).catch(releaseError =>
      logger.warn('[Intelligence] Failed to release work item after error', {
        id: item.id,
        failure: encodeWorkFailure(releaseError),
      })
    );
    return 'failed';
  } finally {
    observeOperationalHistogram(
      'opsknight_intelligence_work_duration_seconds',
      (performance.now() - startedAt) / 1000,
      { kind: metricKind }
    );
  }
}

/**
 * Processes `items` with bounded concurrency; one failing item never affects the others. Every outcome
 * feeds the per-kind breaker, so a handler failing for most of its items is paused on its own.
 */
async function processBatch(
  items: ClaimedWorkItem[],
  settings: IntelligenceSettingsView,
  handlers: WorkHandlers,
  state: LaneState,
  capacity: number,
  lease: BatchLease,
  now: () => number
) {
  const counts = { completed: 0, requeued: 0, failed: 0, lost: 0 };
  let next = 0;
  const workers = Array.from({ length: Math.min(capacity, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      const result = await processItem(item, settings, handlers, state, lease);
      if (result === 'completed') counts.completed += 1;
      else if (result === 'requeued') counts.requeued += 1;
      else if (result === 'failed') counts.failed += 1;
      else counts.lost += 1;
      if (result === 'lost') continue;
      if (state.kinds.record(item.kind, result !== 'failed', now()) === 'paused') {
        logger.warn('[Intelligence] Pausing one kind of work after repeated failures', {
          kind: item.kind,
        });
      }
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
  return withIntelligenceReadMemo(() => runCycle(state, dependencies));
}

async function runCycle(state: LaneState, dependencies: CycleDependencies): Promise<CycleResult> {
  const handlers = dependencies.handlers ?? DEFAULT_HANDLERS;
  const now = dependencies.now ?? Date.now;
  const base = (): CycleResult => ({
    ...EMPTY_RESULT,
    timedOut: state.timedOut.size,
    pausedKinds: state.kinds.pausedKinds(now()),
  });
  try {
    const settings = await getIntelligenceSettings();

    // Paging comes first, for every database-heavy step including retention. While intelligence is off the
    // backlog is read only when a sweep is actually due, so a disabled install still reads one settings
    // row per poll.
    const sweepDue =
      (settings.revision > 0 && now() - state.lastRetentionAt >= RETENTION_INTERVAL_MS) ||
      (handlers === DEFAULT_HANDLERS &&
        now() - state.lastConversationSweepAt >= RETENTION_INTERVAL_MS);
    if (!settings.enabled && !sweepDue) return { ...base(), status: 'disabled' };

    const waitingQueries = await (dependencies.getPoolWaitingQueries ?? getPrismaPoolWaitCount)();
    state.poolWaitingQueries = waitingQueries;
    // Do not add a SQL probe behind work already waiting for a pool connection.
    const criticalLagMs =
      waitingQueries !== null && waitingQueries > 0
        ? 0
        : await (dependencies.getCriticalLagMs ?? (() => getCriticalBacklogLagMs()))();
    const pause = evaluateLanePause(
      state.pause,
      criticalLagMs,
      settings.backpressureEscalationLagMs,
      waitingQueries
    );
    const { changed, ...nextPause } = pause;
    state.pause = nextPause;
    if (changed) {
      logger.warn(
        pause.paused
          ? '[Intelligence] Pausing to protect paging and database capacity'
          : '[Intelligence] Resuming after paging and database capacity recovered',
        { criticalLagMs, waitingQueries, thresholdMs: settings.backpressureEscalationLagMs }
      );
    }
    if (pause.paused)
      return { ...base(), status: settings.enabled ? 'paused' : 'disabled', criticalLagMs };

    // Retention is honoured even while intelligence is switched off; an unconfigured install
    // (revision 0) has nothing to purge, so it pays no cost. One replica sweeps at a time. Batches
    // shrink while a table keeps failing and grow back once sweeps are clean.
    if (settings.revision > 0 && now() - state.lastRetentionAt >= RETENTION_INTERVAL_MS) {
      state.lastRetentionAt = now();
      const defaultBatch = Math.max(settings.batchSize * 10, 100);
      const batchSize = Math.min(state.retentionBatchSize ?? defaultBatch, defaultBatch);
      try {
        const purged = await purgeExpiredIntelligenceData(settings, {
          batchSize,
          now: new Date(now()),
        });
        state.retentionBatchSize =
          purged.failedTables.length > 0
            ? Math.max(RETENTION_MIN_BATCH, Math.floor(batchSize / 2))
            : Math.min(defaultBatch, batchSize * 2);
        // A large backlog is drained across sweeps; ask for the next one soon instead of waiting.
        if (purged.more) state.lastRetentionAt = now() - RETENTION_INTERVAL_MS + 60_000;
      } catch (error) {
        logger.warn('[Intelligence] Retention sweep failed; will retry', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Saved assistant conversations are swept even with intelligence off: their retention, and their
    // removal when history is switched off, are privacy promises that do not depend on the engine.
    if (
      handlers === DEFAULT_HANDLERS &&
      now() - state.lastConversationSweepAt >= RETENTION_INTERVAL_MS
    ) {
      state.lastConversationSweepAt = now();
      try {
        const swept = await purgeConversations(new Date(now()));
        if (swept.more) state.lastConversationSweepAt = now() - RETENTION_INTERVAL_MS + 60_000;
      } catch (error) {
        logger.warn('[Intelligence] Conversation retention sweep failed; will retry', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!settings.enabled) return { ...base(), status: 'disabled' };

    // Discovery only schedules observation. Source catch-up runs below first-insight work and
    // coalesces another generation until its bounded cursor reaches the safety watermark.
    if (
      handlers[WORK_KINDS.OBSERVE_DEPENDENCIES] &&
      now() - state.lastObserveAt >= OBSERVE_INTERVAL_MS
    ) {
      state.lastObserveAt = now();
      try {
        await enqueueWorkItems([
          { kind: WORK_KINDS.OBSERVE_DEPENDENCIES, subjectKey: DEPENDENCY_OBSERVER_SUBJECT },
        ]);
      } catch (error) {
        logger.warn('[Intelligence] Dependency observation failed; will retry', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Cheap when semantic search is off: the model lookup is cached and nothing is enqueued.
    if (handlers[WORK_KINDS.EMBED_PENDING] && now() - state.lastEmbedAt >= EMBED_INTERVAL_MS) {
      state.lastEmbedAt = now();
      try {
        if (await currentEmbeddingModel()) {
          await enqueueWorkItems([
            { kind: WORK_KINDS.EMBED_PENDING, subjectKey: SEMANTIC_SUBJECT },
          ]);
        }
      } catch (error) {
        logger.warn('[Intelligence] Could not schedule semantic indexing; will retry', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (
      handlers[WORK_KINDS.SEND_DIGEST] &&
      now() - state.lastDigestCheckAt >= DIGEST_CHECK_INTERVAL_MS
    ) {
      state.lastDigestCheckAt = now();
      try {
        await scheduleDigestIfDue(new Date(now()));
      } catch (error) {
        logger.warn('[Intelligence] Could not schedule the weekly digest; will retry', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Declared-topology sources are pulled on their own schedule; a source that is not due costs one read.
    if (
      handlers[WORK_KINDS.SYNC_TOPOLOGY] &&
      now() - state.lastTopologyCheckAt >= TOPOLOGY_SYNC_CHECK_INTERVAL_MS
    ) {
      state.lastTopologyCheckAt = now();
      try {
        await scheduleTopologySyncsIfDue(new Date(now()));
      } catch (error) {
        logger.warn('[Intelligence] Could not schedule topology syncs; will retry', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let discovered = 0;
    let repaired = 0;
    const sum = (counts: {
      missing: number;
      staleResolution: number;
      suppressed: number;
      staleSource: number;
    }) => counts.missing + counts.staleResolution + counts.suppressed + counts.staleSource;
    try {
      const discovery = await discoverNewIncidents({
        limit: settings.batchSize * DISCOVERY_BATCH_MULTIPLIER,
        now: new Date(now()),
      });
      discovered = discovery.discovered;
      // Lost wake hints for existing incidents are repaired here every cycle, in O(changes).
      repaired += sum(
        await reconcileUpdatedIncidents({
          limit: settings.batchSize,
          now: new Date(now()),
          maxDbMs: settings.maxDbMs,
        })
      );
      if (now() - state.lastReconcileAt >= RECONCILE_INTERVAL_MS) {
        state.lastReconcileAt = now();
        repaired += sum(
          await reconcileFingerprints({
            limit: settings.batchSize,
            lookbackDays: Math.min(settings.lookbackDays, RECONCILE_LOOKBACK_DAYS),
            now: new Date(now()),
            maxDbMs: settings.maxDbMs,
          })
        );
      }
    } catch (error) {
      logger.warn('[Intelligence] Discovery failed; continuing with queued work', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Timed-out handlers that have not let go yet still hold connections: they keep their slots.
    const capacity = settings.maxConcurrency - state.timedOut.size;
    if (capacity <= 0) {
      if (!state.saturatedLogged) {
        state.saturatedLogged = true;
        logger.warn(
          '[Intelligence] Deferring new work until timed-out handlers release their connections',
          { timedOut: state.timedOut.size, maxConcurrency: settings.maxConcurrency }
        );
      }
      return {
        ...base(),
        status: 'idle',
        criticalLagMs,
        discovered,
        repaired,
        saturated: true,
      };
    }
    state.saturatedLogged = false;

    const leaseMs = settings.maxJobMs * 2;
    const claimed = await claimWorkItems({
      limit: settings.batchSize,
      leaseMs,
      excludeKinds: state.kinds.pausedKinds(now()),
    });
    if (claimed.length === 0) {
      return {
        ...base(),
        status: discovered + repaired > 0 ? 'worked' : 'idle',
        criticalLagMs,
        discovered,
        repaired,
      };
    }
    const counts = await processBatch(
      claimed,
      settings,
      handlers,
      state,
      capacity,
      { claimedAt: performance.now(), leaseMs },
      now
    );
    return {
      ...base(),
      status: 'worked',
      criticalLagMs,
      discovered,
      repaired,
      claimed: claimed.length,
      ...counts,
    };
  } catch (error) {
    logger.warn('[Intelligence] Cycle failed; will retry', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...base(), status: 'idle' };
  }
}

export interface LaneTotals {
  cycles: number;
  claimed: number;
  completed: number;
  requeued: number;
  failed: number;
  lost: number;
}

export interface LaneStatus {
  running: boolean;
  /** When this process started the lane; a lane that has never completed a cycle is judged from here. */
  startedAt: Date | null;
  lastCycleAt: Date | null;
  lastResult: CycleResult | null;
  paused: boolean;
  poolWaitingQueries?: number | null;
  pauseReason?: 'pool' | 'paging' | null;
  timedOutInFlight: number;
  saturated: boolean;
  pausedKinds: string[];
  /** Whether this replica turns wake hints into work; null when no listener session exists. */
  wakeLeader: boolean | null;
  /** Cumulative since process start; lets operators and benchmarks see real throughput. */
  totals: LaneTotals;
}

const lane: {
  timer: ReturnType<typeof setTimeout> | null;
  active: Promise<void> | null;
  running: boolean;
  startedAt: Date | null;
  state: LaneState;
  lastCycleAt: Date | null;
  lastResult: CycleResult | null;
  totals: LaneTotals;
} = {
  timer: null,
  active: null,
  running: false,
  startedAt: null,
  state: createLaneState(),
  lastCycleAt: null,
  lastResult: null,
  totals: { cycles: 0, claimed: 0, completed: 0, requeued: 0, failed: 0, lost: 0 },
};

const IDLE_POLL_MS = 5_000;
const BUSY_POLL_MS = 250;
/** While disabled the lane only re-reads one settings row, so it polls slowly. */
const DISABLED_POLL_MS = 30_000;

/**
 * Roles that host the lane. It shares the general worker's place in the topology; the dedicated
 * `intelligence-worker` role runs only this lane, so analysis can scale and fail apart from paging.
 */
const LANE_ROLES: ReadonlySet<string> = new Set([
  'integrated',
  'worker',
  'general-worker',
  'intelligence-worker',
]);

export function shouldRunIntelligenceLane(
  role: string,
  dedicated = isIntelligenceDedicatedProcess()
): boolean {
  if (dedicated) return role === 'intelligence-worker';
  return LANE_ROLES.has(role);
}

let wakeListener: ReturnType<typeof listenForIntelligenceWake> | undefined;
let wakeRequested = false;
const signalled = new Set<string>();
let acceptingSignals = false;

async function acceptWakeSignals(ids: string[]): Promise<void> {
  for (const id of ids) if (signalled.size < 1000) signalled.add(id);
  if (acceptingSignals) return;
  acceptingSignals = true;
  try {
    while (lane.running && signalled.size) {
      const batch = [...signalled].slice(0, 50);
      for (const id of batch) signalled.delete(id);
      if (!(await getIntelligenceSettings()).enabled) {
        signalled.clear();
        break;
      }
      await enqueueWorkItems(
        batch.map(subjectKey => ({
          kind: WORK_KINDS.INDEX_INCIDENT,
          subjectKey,
          priority: FIRST_INSIGHT_INDEX_PRIORITY,
        }))
      );
      wakeRequested = true;
      if (!lane.active) {
        if (lane.timer) clearTimeout(lane.timer);
        schedule(0);
      }
    }
  } catch {
    signalled.clear(); // Durable discovery is authoritative on any hint failure.
  } finally {
    acceptingSignals = false;
  }
}

function nextDelayMs(result: CycleResult): number {
  if (wakeRequested) {
    wakeRequested = false;
    return BUSY_POLL_MS;
  }
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
        lane.totals.lost += result.lost;
        schedule(jittered(nextDelayMs(result)));
      })
      // runIntelligenceCycle never throws, but a lane that dies silently is the worst outcome: keep it alive.
      .catch(error => {
        logger.error('[Intelligence] Lane scheduling failed; restarting the loop', {
          error: error instanceof Error ? error.message : String(error),
        });
        schedule(jittered(IDLE_POLL_MS));
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
  lane.startedAt = new Date();
  wakeListener = listenForIntelligenceWake(
    ids => {
      void acceptWakeSignals(ids);
    },
    undefined,
    { electLeader: true }
  );
  schedule(jittered(options.initialDelayMs ?? IDLE_POLL_MS));
}

/** Stops scheduling and waits for the in-flight cycle so shutdown never abandons claimed work. */
export async function stopIntelligenceLane(): Promise<void> {
  lane.running = false;
  await wakeListener?.stop();
  wakeListener = undefined;
  signalled.clear();
  if (lane.timer) clearTimeout(lane.timer);
  lane.timer = null;
  await lane.active;
}

export function getIntelligenceLaneStatus(): LaneStatus {
  return {
    running: lane.running,
    startedAt: lane.startedAt,
    lastCycleAt: lane.lastCycleAt,
    lastResult: lane.lastResult,
    paused: lane.state.pause.paused,
    poolWaitingQueries: lane.state.poolWaitingQueries ?? null,
    pauseReason: lane.state.pause.paused
      ? (lane.state.pause.poolRecoverySamples ?? 0) > 0
        ? 'pool'
        : 'paging'
      : null,
    timedOutInFlight: lane.state.timedOut.size,
    saturated: lane.lastResult?.saturated ?? false,
    pausedKinds: lane.state.kinds.pausedKinds(),
    wakeLeader: wakeListener ? wakeListener.isLeader() : null,
    totals: { ...lane.totals },
  };
}
