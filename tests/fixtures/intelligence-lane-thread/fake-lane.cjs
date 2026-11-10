// A stand-in lane thread for tests/unit/intelligence-lane-thread.test.ts. It speaks the lane-thread
// protocol (lane-thread-channel.ts) without a database. Behaviour comes from workerData:
//   crashes: SharedArrayBuffer int32 counter; while it is below `crashTimes` the thread throws after
//            `crashAfterMs`, so a test can watch the host restart it.
//   exitCode: exit with this code instead of throwing (when crashing).
//   stopDelayMs: how long stopping the lane takes (an in-flight cycle finishing).
//   ignoreStop: never answer `stop`, so the host must terminate the thread.
const { parentPort, workerData } = require('node:worker_threads');

const data = workerData;
const crashes = data.crashes ? new Int32Array(data.crashes) : null;
const startedAt = new Date();
let cycles = 0;
let running = true;
const status = () => ({
  running,
  startedAt,
  lastCycleAt: cycles ? new Date() : null,
  lastResult: cycles
    ? {
        status: 'worked',
        criticalLagMs: 0,
        discovered: 0,
        repaired: 0,
        claimed: 1,
        completed: 1,
        requeued: 0,
        failed: 0,
        lost: 0,
        timedOut: 0,
        saturated: false,
        pausedKinds: [],
      }
    : null,
  paused: false,
  poolWaitingQueries: 0,
  pauseReason: null,
  timedOutInFlight: 0,
  saturated: false,
  pausedKinds: [],
  yieldingToIngestion: false,
  wakeLeader: true,
  totals: { cycles, claimed: cycles, completed: cycles, requeued: 0, failed: 0, lost: 0 },
});
const metrics = () => ({
  values: [
    [
      'opsknight_intelligence_work_failures_total',
      [{ labels: { kind: 'INDEX_INCIDENT' }, value: cycles }],
    ],
  ],
  histograms: [],
});
const report = () => parentPort.postMessage({ type: 'status', status: status(), metrics: metrics() });

const timer = setInterval(() => {
  cycles += 1;
  report();
}, 10);

if (crashes && Atomics.load(crashes, 0) < (data.crashTimes ?? 0)) {
  setTimeout(() => {
    Atomics.add(crashes, 0, 1);
    if (data.exitCode !== undefined) process.exit(data.exitCode);
    throw new Error('fake lane crashed');
  }, data.crashAfterMs ?? 30);
}

parentPort.on('message', message => {
  if (message && message.type === 'probe') {
    parentPort.postMessage({
      type: 'probe',
      env: process.env.OPSKNIGHT_INTELLIGENCE_LANE_THREAD ?? null,
      inFlight: new Float64Array(data.activity, 8, 3)[0],
      poolWaiting: Atomics.load(new Int32Array(data.poolWaiting), 0),
      extra: data.extra ?? null,
    });
    return;
  }
  if (!message || message.type !== 'stop' || data.ignoreStop) return;
  clearInterval(timer);
  setTimeout(() => {
    running = false;
    report();
    parentPort.postMessage({ type: 'stopped' });
    parentPort.close();
  }, data.stopDelayMs ?? 0);
});
