import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import {
  beginIngestionActivity,
  readSharedIngestionActivity,
  shareIngestionActivity,
  snapshotIngestionActivity,
} from '@/lib/ingestion/activity';
import {
  LANE_THREAD_BUNDLE,
  laneThreadAppRoots,
  laneThreadMode,
  planIntegratedLane,
  type LaneStandIn,
  laneThreadWorker,
  resolveLaneThreadEntry,
  restartDelayMs,
  shouldRunLaneInThread,
  startIntelligenceLaneThread,
  stopIntelligenceLaneThread,
} from '@/lib/intelligence/jobs/lane-thread';
import {
  createPoolWaitingBuffer,
  laneHostForThread,
  readPoolWaiting,
  serveLaneThread,
  writePoolWaiting,
} from '@/lib/intelligence/jobs/lane-thread-channel';
import {
  getIntelligenceLaneStatus,
  setIntelligenceLaneMode,
  type LaneStatus,
} from '@/lib/intelligence/jobs/runner';
import { evaluateLaneHealth } from '@/lib/intelligence/metrics';
import {
  clearRuntimeOperationalMetrics,
  exportRuntimeOperationalMetricState,
  mergeRuntimeOperationalMetricState,
  runtimeOperationalMetrics,
} from '@/lib/metrics/operational/registry';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma-pool-pressure', () => ({ getPrismaPoolWaitCount: async () => null }));

const FAKE_LANE = join(process.cwd(), 'tests/fixtures/intelligence-lane-thread/fake-lane.cjs');

async function until(condition: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

afterEach(async () => {
  await stopIntelligenceLaneThread();
  globalThis.opsKnightIntelligenceLaneStatusSource = undefined;
  setIntelligenceLaneMode(undefined);
});

describe('lane thread placement', () => {
  it('runs the lane in a thread only in the integrated role, unless switched off', () => {
    expect(shouldRunLaneInThread('integrated', 'auto')).toBe(true);
    expect(shouldRunLaneInThread('integrated', 'off')).toBe(false);
    // Dedicated and other shared roles keep their lane exactly as before.
    for (const role of ['intelligence-worker', 'worker', 'general-worker', 'web'])
      expect(shouldRunLaneInThread(role, 'auto')).toBe(false);
    expect(laneThreadMode(undefined)).toBe('auto');
    expect(laneThreadMode(' OFF ')).toBe('off');
    expect(laneThreadMode('on')).toBe('auto');
  });

  it('uses the bundled entry when the build has one and nothing otherwise', () => {
    expect(resolveLaneThreadEntry('/app', path => path === join('/app', LANE_THREAD_BUNDLE))).toBe(
      join('/app', LANE_THREAD_BUNDLE)
    );
    expect(resolveLaneThreadEntry('/app', () => false)).toBeNull();
  });

  it('finds the bundle from the app root in dev, Docker and a standalone start from source', () => {
    // `next dev`, `next start` and the Docker image run from the app root.
    expect(laneThreadAppRoots('/app')).toEqual(['/app']);
    // `node .next/standalone/server.js` changes into the standalone directory of a source checkout.
    const standalone = join('/src/opsknight', '.next', 'standalone');
    expect(laneThreadAppRoots(standalone)).toEqual([standalone, '/src/opsknight']);
    expect(
      resolveLaneThreadEntry(
        standalone,
        path => path === join('/src/opsknight', LANE_THREAD_BUNDLE)
      )
    ).toBe(join('/src/opsknight', LANE_THREAD_BUNDLE));
    // A bundle beside the standalone server wins over the checkout's.
    expect(resolveLaneThreadEntry(standalone, () => true)).toBe(
      join(standalone, LANE_THREAD_BUNDLE)
    );
    // Only that exact layout looks further up.
    expect(laneThreadAppRoots('/srv/standalone')).toEqual(['/srv/standalone']);
  });

  it('plans the thread for integrated and names the reason when it has to fall back', () => {
    expect(planIntegratedLane('integrated', 'auto', '/app/bundle.cjs')).toEqual({
      mode: 'thread',
      fallbackReason: null,
      remedy: '',
    });
    const missing = planIntegratedLane('integrated', 'auto', null);
    expect(missing).toMatchObject({ mode: 'in-process', fallbackReason: 'bundle-missing' });
    expect(missing.remedy).toContain('npm run build');
    const off = planIntegratedLane('integrated', 'off', '/app/bundle.cjs');
    expect(off).toMatchObject({ mode: 'in-process', fallbackReason: 'disabled-by-env' });
    expect(off.remedy).toContain('INTELLIGENCE_LANE_THREAD=off');
    // In-process is the design in every other role, never a fallback.
    for (const role of ['intelligence-worker', 'worker', 'general-worker'])
      expect(planIntegratedLane(role, 'auto', null)).toEqual({
        mode: 'in-process',
        fallbackReason: null,
        remedy: '',
      });
  });

  it('backs restarts off exponentially up to a minute', () => {
    expect([1, 2, 3, 4].map(restartDelayMs)).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(restartDelayMs(30)).toBe(60_000);
  });

  it('starts nothing and reports false when there is no thread entry', () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-opsknight');
    try {
      expect(startIntelligenceLaneThread()).toBe(false);
      expect(laneThreadWorker()).toBeNull();
    } finally {
      cwd.mockRestore();
    }
  });
});

describe('shared memory between ingestion and a lane thread', () => {
  it('mirrors ingestion activity so another thread reads the same load', () => {
    const buffer = shareIngestionActivity();
    expect(shareIngestionActivity()).toBe(buffer); // one mirror per process
    const before = readSharedIngestionActivity(buffer);
    const end = beginIngestionActivity();
    const during = readSharedIngestionActivity(buffer);
    expect(during.inFlight).toBe(snapshotIngestionActivity().inFlight);
    expect(during.inFlight).toBe(before.inFlight + 1);
    end();
    const later = readSharedIngestionActivity(buffer, during.at + 50);
    expect(later.inFlight).toBe(before.inFlight);
    // The integral keeps growing while events are in flight, on the reader's clock.
    expect(later.integralMs).toBeGreaterThanOrEqual(during.integralMs);
  });

  it('carries the main pool waiting count, with unknown kept distinct from zero', () => {
    const buffer = createPoolWaitingBuffer();
    expect(readPoolWaiting(buffer)).toBeNull();
    writePoolWaiting(buffer, 3);
    expect(readPoolWaiting(buffer)).toBe(3);
    writePoolWaiting(buffer, 0);
    expect(readPoolWaiting(buffer)).toBe(0);
    writePoolWaiting(buffer, null);
    expect(readPoolWaiting(buffer)).toBeNull();
    writePoolWaiting(buffer, Number.NaN);
    expect(readPoolWaiting(buffer)).toBeNull();
  });

  it('gives the lane in a thread the main thread activity and pool, not its own', async () => {
    const data = { activity: shareIngestionActivity(), poolWaiting: createPoolWaitingBuffer() };
    writePoolWaiting(data.poolWaiting, 7);
    const host = laneHostForThread(data);
    expect(await host.poolWaitingQueries()).toBe(7);
    const end = beginIngestionActivity();
    try {
      expect(host.activity().inFlight).toBe(snapshotIngestionActivity().inFlight);
    } finally {
      end();
    }
  });
});

describe('serving the main thread from a lane thread', () => {
  function fakePort() {
    const sent: Array<{ type: string }> = [];
    let listener: ((message: unknown) => void) | null = null;
    return {
      sent,
      closed: false,
      postMessage(message: { type: string }) {
        sent.push(message);
      },
      on(_event: 'message', callback: (message: unknown) => void) {
        listener = callback;
      },
      close() {
        this.closed = true;
      },
      deliver(message: unknown) {
        listener?.(message);
      },
    };
  }
  const status = () => getIntelligenceLaneStatus();

  it('throttles status reports but always sends the latest one', async () => {
    const port = fakePort();
    let now = 0;
    const server = serveLaneThread(
      port,
      { status, stop: async () => {} },
      { reportIntervalMs: 20, now: () => now }
    );
    server.report();
    server.report();
    server.report();
    expect(port.sent).toHaveLength(1);
    now = 5;
    server.report();
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(port.sent).toHaveLength(2); // the trailing report
    expect(port.sent.every(message => message.type === 'status')).toBe(true);
  });

  it('stops the lane on request, then reports, says stopped and closes', async () => {
    const port = fakePort();
    let stopped = false;
    serveLaneThread(port, {
      status,
      stop: async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        stopped = true;
      },
    });
    port.deliver({ type: 'unknown' });
    port.deliver({ type: 'stop' });
    port.deliver({ type: 'stop' }); // a repeated request never stops twice
    await until(() => port.closed);
    expect(stopped).toBe(true);
    expect(port.sent.map(message => message.type)).toEqual(['status', 'stopped']);
  });

  it('still says stopped when stopping the lane fails', async () => {
    const port = fakePort();
    serveLaneThread(port, {
      status,
      stop: async () => {
        throw new Error('stop failed');
      },
    });
    port.deliver({ type: 'stop' });
    await until(() => port.closed);
    expect(port.sent.at(-1)?.type).toBe('stopped');
  });
});

describe('lane thread host', () => {
  it('runs the thread with the lane marker and shared buffers, and reports its lane as this process lane', async () => {
    const probes: unknown[] = [];
    expect(
      startIntelligenceLaneThread({
        entry: FAKE_LANE,
        workerData: { extra: 'bench' },
        onMessage: message => probes.push(message),
        poolWaitingQueries: async () => 4,
        poolSampleMs: 5,
      })
    ).toBe(true);
    // Idempotent while running.
    expect(startIntelligenceLaneThread({ entry: FAKE_LANE })).toBe(true);
    await until(() => (getIntelligenceLaneStatus().totals.cycles ?? 0) > 2);
    const status = getIntelligenceLaneStatus();
    expect(status).toMatchObject({ running: true, wakeLeader: true });
    expect(status.thread).toMatchObject({ state: 'running', restarts: 0, lastExit: null });
    expect(evaluateLaneHealth(status)).toEqual({ status: 'healthy' });

    const end = beginIngestionActivity();
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      laneThreadWorker()!.postMessage({ type: 'probe' });
      await until(() => probes.length > 0);
    } finally {
      end();
    }
    expect(probes[0]).toMatchObject({
      type: 'probe',
      env: '1',
      poolWaiting: 4,
      extra: 'bench',
    });
    expect((probes[0] as { inFlight: number }).inFlight).toBeGreaterThanOrEqual(1);

    await stopIntelligenceLaneThread();
    expect(laneThreadWorker()).toBeNull();
    const stopped = getIntelligenceLaneStatus();
    expect(stopped.running).toBe(false);
    expect(stopped.thread?.state).toBe('stopped');
    expect(evaluateLaneHealth(stopped)).toEqual({ status: 'disabled', expected: false });
  });

  it('folds the thread metrics into this process registry by difference', async () => {
    clearRuntimeOperationalMetrics();
    startIntelligenceLaneThread({ entry: FAKE_LANE, poolWaitingQueries: async () => 0 });
    await until(() => getIntelligenceLaneStatus().totals.cycles > 3);
    await stopIntelligenceLaneThread();
    const cycles = getIntelligenceLaneStatus().totals.cycles;
    const failures = runtimeOperationalMetrics().get('opsknight_intelligence_work_failures_total');
    // The fake lane reports a cumulative counter equal to its cycles; the registry holds it once.
    expect(failures?.[0]).toMatchObject({ labels: { kind: 'INDEX_INCIDENT' }, value: cycles });
  });

  it('restarts a crashed thread with backoff, reports it degraded meanwhile and keeps totals', async () => {
    const crashes = new SharedArrayBuffer(4);
    const delays: number[] = [];
    startIntelligenceLaneThread({
      entry: FAKE_LANE,
      workerData: { crashes, crashTimes: 2, crashAfterMs: 40 },
      poolWaitingQueries: async () => 0,
      restartDelayMs: failures => {
        delays.push(failures);
        return 60;
      },
    });
    await until(() => getIntelligenceLaneStatus().thread?.state === 'restarting');
    const restarting = getIntelligenceLaneStatus();
    expect(restarting.thread?.lastExit).toBe('Lane thread failed with an uncaught error');
    expect(evaluateLaneHealth(restarting)).toEqual({
      status: 'degraded',
      error: 'Lane thread stopped unexpectedly; restarting it',
    });
    const carried = restarting.totals.cycles;
    expect(carried).toBeGreaterThan(0);
    // The last real cycle time survives the crash and the restart, until the new thread reports one.
    expect(restarting.lastCycleAt).not.toBeNull();
    await until(() => getIntelligenceLaneStatus().thread?.restarts === 1);
    expect(getIntelligenceLaneStatus().lastCycleAt).not.toBeNull();
    await until(
      () =>
        getIntelligenceLaneStatus().thread?.restarts === 2 &&
        getIntelligenceLaneStatus().thread?.state === 'running'
    );
    expect(getIntelligenceLaneStatus().lastCycleAt).not.toBeNull();
    expect(delays).toEqual([1, 2]); // consecutive failures back off
    await until(() => getIntelligenceLaneStatus().totals.cycles > carried + 2);
    expect(Atomics.load(new Int32Array(crashes), 0)).toBe(2);
  });

  it('describes a thread that exits with a non-zero code', async () => {
    const crashes = new SharedArrayBuffer(4);
    startIntelligenceLaneThread({
      entry: FAKE_LANE,
      workerData: { crashes, crashTimes: 1, crashAfterMs: 20, exitCode: 3 },
      poolWaitingQueries: async () => 0,
      restartDelayMs: () => 10_000,
    });
    await until(() => getIntelligenceLaneStatus().thread?.state === 'restarting');
    expect(getIntelligenceLaneStatus().thread?.lastExit).toBe('Lane thread exited with code 3');
    // Stopping during the restart delay cancels the restart.
    await stopIntelligenceLaneThread();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(laneThreadWorker()).toBeNull();
    expect(getIntelligenceLaneStatus().thread?.state).toBe('stopped');
  });

  it('waits for the in-flight cycle when stopping', async () => {
    startIntelligenceLaneThread({
      entry: FAKE_LANE,
      workerData: { stopDelayMs: 150 },
      poolWaitingQueries: async () => 0,
    });
    await until(() => getIntelligenceLaneStatus().thread?.state === 'running');
    const started = performance.now();
    await stopIntelligenceLaneThread();
    expect(performance.now() - started).toBeGreaterThanOrEqual(140);
    expect(getIntelligenceLaneStatus().running).toBe(false);
  });

  it('terminates a thread that does not stop in time', async () => {
    startIntelligenceLaneThread({
      entry: FAKE_LANE,
      workerData: { ignoreStop: true },
      poolWaitingQueries: async () => 0,
      stopTimeoutMs: 100,
    });
    await until(() => getIntelligenceLaneStatus().thread?.state === 'running');
    const worker = laneThreadWorker()!;
    let exited = false;
    worker.once('exit', () => {
      exited = true;
    });
    await stopIntelligenceLaneThread();
    expect(exited).toBe(true);
    // A terminated thread is not a crash: nothing restarts it.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(getIntelligenceLaneStatus().thread).toMatchObject({ state: 'stopped', restarts: 0 });
  });
});

describe('lane thread only while intelligence is enabled', () => {
  const totals = { cycles: 3, claimed: 0, completed: 0, requeued: 0, failed: 0, lost: 0 };
  function standIn() {
    const calls = { started: 0, stopped: 0 };
    let handOff: (() => void) | null = null;
    const lane: LaneStandIn = {
      start: callback => {
        calls.started += 1;
        handOff = callback;
      },
      stop: async () => {
        calls.stopped += 1;
        handOff = null;
      },
      status: () =>
        ({
          running: true,
          startedAt: new Date(),
          lastCycleAt: new Date(),
          lastResult: { status: 'disabled' },
          paused: false,
          timedOutInFlight: 0,
          saturated: false,
          pausedKinds: [],
          wakeLeader: null,
          totals: { ...totals },
        }) as unknown as LaneStatus,
    };
    return { lane, calls, enable: () => handOff?.() };
  }

  it('starts no thread while disabled and reports the lane as disabled, not degraded', async () => {
    const main = standIn();
    expect(startIntelligenceLaneThread({ entry: FAKE_LANE, standIn: main.lane })).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(laneThreadWorker()).toBeNull();
    expect(main.calls).toEqual({ started: 1, stopped: 0 });
    const status = getIntelligenceLaneStatus();
    expect(status.thread).toMatchObject({ state: 'parked', restarts: 0 });
    expect(status.totals.cycles).toBe(3);
    expect(evaluateLaneHealth(status)).toEqual({ status: 'disabled', expected: false });
    await stopIntelligenceLaneThread();
    expect(main.calls).toEqual({ started: 1, stopped: 1 });
    expect(laneThreadWorker()).toBeNull();
  });

  it('hands the lane to a thread once enabled, exactly once', async () => {
    const main = standIn();
    startIntelligenceLaneThread({ entry: FAKE_LANE, standIn: main.lane });
    main.enable();
    main.enable();
    await until(() => getIntelligenceLaneStatus().thread?.state === 'running');
    expect(main.calls).toEqual({ started: 1, stopped: 1 });
    expect(laneThreadWorker()).not.toBeNull();
    await until(() => getIntelligenceLaneStatus().totals.cycles > 5);
    expect(evaluateLaneHealth(getIntelligenceLaneStatus())).toEqual({ status: 'healthy' });
  });

  it('stops the thread and parks the lane again when intelligence is disabled', async () => {
    const main = standIn();
    startIntelligenceLaneThread({
      entry: FAKE_LANE,
      standIn: main.lane,
      workerData: { disabledAfterMs: 60 },
    });
    main.enable();
    await until(() => laneThreadWorker() !== null);
    await until(() => getIntelligenceLaneStatus().thread?.state === 'parked');
    expect(laneThreadWorker()).toBeNull();
    expect(main.calls).toEqual({ started: 2, stopped: 1 });
    const status = getIntelligenceLaneStatus();
    // Parking is not a crash: no restart is counted and nothing is degraded.
    expect(status.thread).toMatchObject({ restarts: 0, lastExit: null });
    expect(evaluateLaneHealth(status)).toEqual({ status: 'disabled', expected: false });
  });

  it('starts no thread when stopped while the hand-off is in progress', async () => {
    const main = standIn();
    startIntelligenceLaneThread({ entry: FAKE_LANE, standIn: main.lane });
    main.enable();
    await stopIntelligenceLaneThread();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(laneThreadWorker()).toBeNull();
    expect(getIntelligenceLaneStatus().running).toBe(false);
  });
});

describe('lane mode in status', () => {
  it('reports the mode recorded at startup and the fallback reason', () => {
    expect(getIntelligenceLaneStatus()).toMatchObject({ mode: 'in-process', fallbackReason: null });
    setIntelligenceLaneMode({ mode: 'in-process', fallbackReason: 'bundle-missing' });
    expect(getIntelligenceLaneStatus()).toMatchObject({
      mode: 'in-process',
      fallbackReason: 'bundle-missing',
    });
    setIntelligenceLaneMode({ mode: 'thread', fallbackReason: null });
    expect(getIntelligenceLaneStatus()).toMatchObject({ mode: 'thread', fallbackReason: null });
  });
});

describe('runtime metric forwarding', () => {
  it('adds counters and histograms by difference and sets gauges', () => {
    clearRuntimeOperationalMetrics();
    const first = {
      values: [
        [
          'opsknight_intelligence_work_failures_total',
          [{ labels: { kind: 'INDEX_INCIDENT' }, value: 2 }],
        ],
        ['not_a_registered_metric', [{ labels: {}, value: 9 }]],
      ] as Array<[string, Array<{ labels: Record<string, string>; value: number }>]>,
      histograms: [
        [
          'opsknight_intelligence_work_duration_seconds',
          [
            {
              labels: { kind: 'INDEX_INCIDENT' },
              value: 1.5,
              count: 2,
              buckets: [0, 0, 0, 0, 1, 2, 2, 2, 2],
            },
          ],
        ],
      ] as Array<
        [
          string,
          Array<{
            labels: Record<string, string>;
            value: number;
            count: number;
            buckets: number[];
          }>,
        ]
      >,
    };
    mergeRuntimeOperationalMetricState(null, first);
    const second = {
      ...first,
      values: [
        [
          'opsknight_intelligence_work_failures_total',
          [
            { labels: { kind: 'INDEX_INCIDENT' }, value: 5 },
            { labels: { wrong: 'label' }, value: 1 },
          ],
        ],
      ] as typeof first.values,
      histograms: [
        [
          'opsknight_intelligence_work_duration_seconds',
          [
            {
              labels: { kind: 'INDEX_INCIDENT' },
              value: 4,
              count: 5,
              buckets: [0, 0, 0, 1, 2, 5, 5, 5, 5],
            },
          ],
        ],
      ] as typeof first.histograms,
    };
    mergeRuntimeOperationalMetricState(first, second);
    const histogram = () =>
      exportRuntimeOperationalMetricState().histograms.find(
        ([name]) => name === 'opsknight_intelligence_work_duration_seconds'
      )?.[1];
    expect(histogram()).toEqual(second.histograms[0][1]);
    expect(runtimeOperationalMetrics().get('opsknight_intelligence_work_failures_total')).toEqual([
      { labels: { kind: 'INDEX_INCIDENT' }, value: 5 },
    ]);
    // A thread's export round-trips through the merge.
    const exported = exportRuntimeOperationalMetricState();
    clearRuntimeOperationalMetrics();
    mergeRuntimeOperationalMetricState(null, exported);
    expect(runtimeOperationalMetrics().get('opsknight_intelligence_work_failures_total')).toEqual([
      { labels: { kind: 'INDEX_INCIDENT' }, value: 5 },
    ]);
    expect(histogram()).toEqual(second.histograms[0][1]);
    // A report that did not move leaves everything as it is.
    mergeRuntimeOperationalMetricState(exported, exported);
    expect(histogram()).toEqual(second.histograms[0][1]);
  });
});
