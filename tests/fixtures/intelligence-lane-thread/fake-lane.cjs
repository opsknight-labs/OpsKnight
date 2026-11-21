// A stand-in lane process for tests/unit/intelligence-lane-thread.test.ts. It speaks the lane-thread
// protocol (lane-thread-channel.ts) without a database. Behaviour comes from the host's `workerData`
// (OPSKNIGHT_INTELLIGENCE_LANE_DATA):
//   crashes: path of a counter file; while it is below `crashTimes` the process throws after
//            `crashAfterMs`, so a test can watch the host restart it.
//   exitCode: exit with this code instead of throwing (when crashing).
//   stopDelayMs: how long stopping the lane takes (an in-flight cycle finishing).
//   disabledAfterMs: after this long every cycle reports `disabled` (intelligence switched off).
//   ignoreStop: never answer `stop`, so the host must kill the process.
const { existsSync, readFileSync, writeFileSync } = require('node:fs');

const data = JSON.parse(process.env.OPSKNIGHT_INTELLIGENCE_LANE_DATA || '{}');
const crashCount = () =>
  data.crashes && existsSync(data.crashes) ? Number(readFileSync(data.crashes, 'utf8')) : 0;
const parentPort = { postMessage: message => process.connected && process.send(message) };
let activity = [0, 0, 0];
let poolWaiting = null;
process.on('disconnect', () => process.exit(0));
const startedAt = new Date();
let cycles = 0;
let running = true;
const status = () => ({
  running,
  startedAt,
  lastCycleAt: cycles ? new Date() : null,
  lastResult: cycles
    ? {
        status:
          data.disabledAfterMs !== undefined &&
          Date.now() - startedAt.getTime() >= data.disabledAfterMs
            ? 'disabled'
            : 'worked',
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
const report = () =>
  parentPort.postMessage({ type: 'status', status: status(), metrics: metrics() });

const timer = setInterval(() => {
  cycles += 1;
  report();
}, 10);

if (data.crashes && crashCount() < (data.crashTimes ?? 0)) {
  setTimeout(() => {
    writeFileSync(data.crashes, String(crashCount() + 1));
    if (data.exitCode !== undefined) process.exit(data.exitCode);
    throw new Error('fake lane crashed');
  }, data.crashAfterMs ?? 30);
}

process.on('message', message => {
  if (message && message.type === 'activity') activity = message.values;
  if (message && message.type === 'pool') poolWaiting = message.waiting;
  if (message && message.type === 'probe') {
    parentPort.postMessage({
      type: 'probe',
      env: process.env.OPSKNIGHT_INTELLIGENCE_LANE_THREAD ?? null,
      inFlight: activity[0],
      poolWaiting,
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
  }, data.stopDelayMs ?? 0);
});
