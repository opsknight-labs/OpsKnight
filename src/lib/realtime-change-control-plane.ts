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
};

declare global {
  // eslint-disable-next-line no-var
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
});

const NORMAL_POLL_MS = 1_000;
const MAX_ERROR_BACKOFF_MS = 10_000;

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
    for (const listener of state.listeners) {
      if (listener.afterGeneration !== null && clock.generation <= listener.afterGeneration)
        continue;
      listener.afterGeneration = clock.generation;
      Promise.resolve(listener.notify(generation)).catch(error =>
        logger.warn('realtime.listener_failed', {
          stream: listener.stream,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
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

/** One database poller per process fans durable changes out to every local SSE subscriber. */
export function subscribeToRealtimeChanges(
  stream: RealtimeStreamKind,
  afterGeneration: string | null,
  notify: Listener['notify']
): () => void {
  const parsed = afterGeneration === null ? null : BigInt(afterGeneration);
  const listener: Listener = { stream, afterGeneration: parsed, notify };
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
  };
}

export function resetRealtimeControlPlaneForTests(): void {
  if (state.timer) clearTimeout(state.timer);
  state.listeners.clear();
  state.timer = null;
  state.polling = false;
  state.lastObservedGeneration = null;
  state.lastChangedAt = null;
  state.consecutiveFailures = 0;
  state.initialRead = null;
  updateSubscriberMetrics();
}
