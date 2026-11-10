/**
 * Worker-thread entry for the ingestion A/B benchmark's candidate arm with `--lane-mode thread` (the
 * production default for `integrated`). It is bundled exactly like the production entry
 * (scripts/build-intelligence-lane-thread.mjs) and started by the production host (lane-thread.ts), so the
 * thread has its own heap and Prisma client and reads the main thread's ingestion activity and pool
 * pressure through shared memory. The only difference from production is the loop: like the in-process
 * candidate it runs cycles back to back with the periodic sweeps held off and the paging-lag probe
 * bypassed, the worst case for contention.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { disconnectPrisma } from '../../../src/lib/prisma';
import {
  DEFAULT_HANDLERS,
  createLaneState,
  configureLaneHost,
  getLocalIntelligenceLaneStatus,
  runIntelligenceCycle,
  type WorkHandlers,
} from '../../../src/lib/intelligence/jobs/runner';
import {
  laneHostForThread,
  serveLaneThread,
  type LaneThreadData,
} from '../../../src/lib/intelligence/jobs/lane-thread-channel';
import type { WorkKind } from '../../../src/lib/intelligence/jobs/work-queue';

if (!parentPort) throw new Error('Run this entry in a worker thread');
const port = parentPort;
const data = workerData as LaneThreadData & { laneYield: boolean };

const tracker = {
  completed: 0,
  started: 0,
  finished: 0,
  stop: false,
  /** Epoch milliseconds, so the main thread can place them on its own clock. */
  spans: [] as { start: number; end: number | null }[],
};
const epoch = () => performance.timeOrigin + performance.now();
const handlers = Object.fromEntries(
  Object.entries(DEFAULT_HANDLERS).map(([kind, handler]) => [
    kind,
    async (...args: Parameters<NonNullable<WorkHandlers[WorkKind]>>) => {
      tracker.started++;
      const span = { start: epoch(), end: null as number | null };
      tracker.spans.push(span);
      try {
        const result = await handler!(...args);
        tracker.completed++;
        return result;
      } finally {
        tracker.finished++;
        span.end = epoch();
      }
    },
  ])
) as WorkHandlers;

const host = laneHostForThread(data);
configureLaneHost(host);
const state = createLaneState();
if (!data.laneYield) state.ingestionYield = undefined;
const cycleStats = { cycles: 0, worked: 0, paused: 0, idle: 0, yieldingCycles: 0 };
const active = (async () => {
  while (!tracker.stop) {
    Object.assign(state, {
      lastReconcileAt: Date.now(),
      lastUpdatedRepairAt: Date.now(),
      lastRetentionAt: Date.now(),
      lastObserveAt: Date.now(),
      lastEmbedAt: Date.now(),
      lastDigestCheckAt: Date.now(),
    });
    const result = await runIntelligenceCycle(state, {
      handlers,
      getCriticalLagMs: async () => 0,
      getPoolWaitingQueries: host.poolWaitingQueries,
    });
    cycleStats.cycles += 1;
    if (result.status === 'worked' || result.status === 'paused' || result.status === 'idle')
      cycleStats[result.status] += 1;
    if (state.ingestionYield?.isYielding()) cycleStats.yieldingCycles += 1;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
})();

port.on('message', message => {
  if ((message as { type?: string } | null)?.type !== 'bench-snapshot') return;
  port.postMessage({
    type: 'bench-tracker',
    completed: tracker.completed,
    started: tracker.started,
    finished: tracker.finished,
    spans: tracker.spans.map(span => ({ ...span })),
    yieldPausedMs: state.ingestionYield?.pausedMs ?? 0,
    cycleStats: { ...cycleStats },
  });
});

serveLaneThread(port, {
  status: getLocalIntelligenceLaneStatus,
  stop: async () => {
    tracker.stop = true;
    try {
      await active;
    } finally {
      await disconnectPrisma().catch(() => {});
    }
  },
});
