import prisma from './prisma';
import { logger } from './logger';
import { addOperationalMetric, setOperationalGauge } from './metrics/operational/registry';

export type RealtimeStreamKind = 'dashboard' | 'widgets';
type Listener = {
  stream: RealtimeStreamKind;
  afterGeneration: bigint | null;
  notify: (generation: string) => void | Promise<void>;
};

type ControlPlaneState = {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setTimeout> | null;
  polling: boolean;
  lastObservedGeneration: bigint | null;
  lastChangedAt: number | null;
  consecutiveFailures: number;
  initialRead: Promise<string | null> | null;
  lastReconciliationAt: number;
};

declare global {
  var realtimeChangeControlPlaneGlobal: ControlPlaneState | undefined;
}

const state: ControlPlaneState = (globalThis.realtimeChangeControlPlaneGlobal ??= {
  listeners: new Set(),
  timer: null,
  polling: false,
  lastObservedGeneration: null,
  lastChangedAt: null,
  consecutiveFailures: 0,
  initialRead: null,
  lastReconciliationAt: 0,
});

const NORMAL_POLL_MS = 1_000;
const MAX_ERROR_BACKOFF_MS = 10_000;
const RECONCILIATION_INTERVAL_MS = 30_000;

function updateSubscriberMetrics(): void {
  for (const stream of ['dashboard', 'widgets'] as const) {
    setOperationalGauge(
      'opsknight_realtime_subscribers',
      [...state.listeners].filter(listener => listener.stream === stream).length,
      { stream }
    );
  }
}

function schedule(delayMs: number): void {
  if (state.timer || state.listeners.size === 0) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void poll();
  }, delayMs);
  state.timer.unref?.();
}

async function readClock(): Promise<{ generation: bigint; changedAt: Date }> {
  const clock = await prisma.realtimeChange.findFirst({
    orderBy: { id: 'desc' },
    select: { id: true, changedAt: true },
  });
  if (!clock) {
    const seed = await prisma.realtimeChange.create({
      data: {},
      select: { id: true, changedAt: true },
    });
    return { generation: seed.id, changedAt: seed.changedAt };
  }
  return { generation: clock.id, changedAt: clock.changedAt };
}

async function poll(): Promise<void> {
  if (state.polling || state.listeners.size === 0) return;
  state.polling = true;
  try {
    const clock = await readClock();
    state.lastObservedGeneration = clock.generation;
    state.lastChangedAt = clock.changedAt.getTime();
    state.consecutiveFailures = 0;
    setOperationalGauge('opsknight_realtime_observed_generation', Number(clock.generation));
    setOperationalGauge(
      'opsknight_realtime_change_age_seconds',
      Math.max(0, (Date.now() - clock.changedAt.getTime()) / 1_000)
    );

    const generation = clock.generation.toString();
    const now = Date.now();
    const reconciliationDue = now - state.lastReconciliationAt >= RECONCILIATION_INTERVAL_MS;
    for (const listener of state.listeners) {
      const changed =
        listener.afterGeneration === null || clock.generation > listener.afterGeneration;
      if (!changed && !reconciliationDue) continue;
      if (changed) listener.afterGeneration = clock.generation;
      const projectionVersion = changed
        ? generation
        : `reconcile:${generation}:${Math.floor(now / RECONCILIATION_INTERVAL_MS)}`;
      Promise.resolve(listener.notify(projectionVersion)).catch(error =>
        logger.warn('realtime.listener_failed', {
          stream: listener.stream,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
    if (reconciliationDue) state.lastReconciliationAt = now;
  } catch (error) {
    state.consecutiveFailures += 1;
    addOperationalMetric('opsknight_realtime_clock_errors_total', 1);
    if (state.consecutiveFailures === 1 || state.consecutiveFailures % 10 === 0) {
      logger.warn('realtime.change_clock_poll_failed', {
        consecutiveFailures: state.consecutiveFailures,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    state.polling = false;
    const delay = Math.min(
      NORMAL_POLL_MS * Math.max(1, state.consecutiveFailures),
      MAX_ERROR_BACKOFF_MS
    );
    schedule(delay);
  }
}

/**
 * Reads the durable clock once when a stream connects. Failure is non-fatal:
 * initial projections still load and the shared poller keeps reconciling.
 */
export async function getRealtimeChangeGeneration(): Promise<string | null> {
  if (state.lastObservedGeneration !== null) return state.lastObservedGeneration.toString();
  if (state.initialRead) return state.initialRead;
  state.initialRead = readClock()
    .then(clock => {
      state.lastObservedGeneration = clock.generation;
      state.lastChangedAt = clock.changedAt.getTime();
      return clock.generation.toString();
    })
    .catch(error => {
      addOperationalMetric('opsknight_realtime_clock_errors_total', 1);
      logger.warn('realtime.change_clock_initial_read_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    })
    .finally(() => {
      state.initialRead = null;
    });
  return state.initialRead;
}

/**
 * Returns a generation that is at least `minimum`. Clients pass the generation they learned
 * from SSE; when this replica's poller lags behind (or has no subscribers), the durable clock
 * is read directly so a generation-keyed cache can never serve a pre-change projection.
 */
const FRESH_READ_MEMO_MS = 250;
let freshRead: Promise<{ generation: bigint; changedAt: Date }> | null = null;
let freshReadAt = 0;
let freshReadResult: { generation: bigint; changedAt: Date } | null = null;

/**
 * Concurrent API requests on a replica without stream subscribers share one clock read, and a
 * result younger than the memo window is reused when it already satisfies `minimum`.
 */
async function readClockShared(minimum: bigint | null) {
  if (
    freshReadResult &&
    Date.now() - freshReadAt < FRESH_READ_MEMO_MS &&
    (minimum === null || freshReadResult.generation >= minimum)
  ) {
    return freshReadResult;
  }
  if (!freshRead) {
    freshRead = readClock()
      .then(clock => {
        freshReadResult = clock;
        freshReadAt = Date.now();
        return clock;
      })
      .finally(() => {
        freshRead = null;
      });
  }
  const clock = await freshRead;
  // A read that began before `minimum` was published cannot satisfy it; read again.
  if (minimum !== null && clock.generation < minimum) {
    freshReadResult = null;
    return readClock();
  }
  return clock;
}

export async function getRealtimeChangeGenerationAtLeast(
  minimum: string | null
): Promise<string | null> {
  // Without local subscribers there is no poller to lean on: skip the separate baseline read
  // and go straight to the shared fresh read.
  const current =
    state.listeners.size === 0
      ? (state.lastObservedGeneration?.toString() ?? null)
      : await getRealtimeChangeGeneration();
  const needsFreshRead =
    state.listeners.size === 0 ||
    (minimum !== null && (current === null || BigInt(current) < BigInt(minimum)));
  if (!needsFreshRead) return current;
  try {
    const clock = await readClockShared(minimum === null ? null : BigInt(minimum));
    if (state.lastObservedGeneration === null || clock.generation > state.lastObservedGeneration) {
      state.lastObservedGeneration = clock.generation;
      state.lastChangedAt = clock.changedAt.getTime();
    }
    return clock.generation.toString();
  } catch (error) {
    addOperationalMetric('opsknight_realtime_clock_errors_total', 1);
    logger.warn('realtime.change_clock_fresh_read_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return current;
  }
}

/** One database poller per process fans durable changes out to every local SSE subscriber. */
export function subscribeToRealtimeChanges(
  stream: RealtimeStreamKind,
  afterGeneration: string | null,
  notify: Listener['notify']
): () => void {
  const parsed = afterGeneration === null ? null : BigInt(afterGeneration);
  const listener: Listener = { stream, afterGeneration: parsed, notify };
  if (state.listeners.size === 0) state.lastReconciliationAt = Date.now();
  state.listeners.add(listener);
  updateSubscriberMetrics();

  if (
    state.lastObservedGeneration !== null &&
    (parsed === null || state.lastObservedGeneration > parsed)
  ) {
    listener.afterGeneration = state.lastObservedGeneration;
    queueMicrotask(() => void listener.notify(state.lastObservedGeneration!.toString()));
  }
  schedule(0);

  return () => {
    state.listeners.delete(listener);
    updateSubscriberMetrics();
    if (state.listeners.size === 0 && state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  };
}

export function getRealtimeControlPlaneStatus() {
  return {
    subscribers: state.listeners.size,
    observedGeneration: state.lastObservedGeneration?.toString() ?? null,
    lastChangeAt: state.lastChangedAt === null ? null : new Date(state.lastChangedAt).toISOString(),
    consecutiveFailures: state.consecutiveFailures,
    lastReconciliationAt:
      state.lastReconciliationAt === 0 ? null : new Date(state.lastReconciliationAt).toISOString(),
  };
}

export function resetRealtimeControlPlaneForTests(): void {
  freshRead = null;
  freshReadAt = 0;
  freshReadResult = null;
  if (state.timer) clearTimeout(state.timer);
  state.listeners.clear();
  state.timer = null;
  state.polling = false;
  state.lastObservedGeneration = null;
  state.lastChangedAt = null;
  state.consecutiveFailures = 0;
  state.initialRead = null;
  state.lastReconciliationAt = 0;
  updateSubscriberMetrics();
}
