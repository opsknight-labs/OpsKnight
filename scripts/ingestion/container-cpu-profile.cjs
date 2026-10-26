/* eslint-disable @typescript-eslint/no-require-imports -- Executable CommonJS inspector client. */
/* eslint-disable security/detect-non-literal-fs-filename -- Validated owned run paths and fixed cgroup diagnostic files. */
// Diagnostic client copied into an owned certification container. Inspector is
// enabled only on that container's loopback interface and never published.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [runId, output, stop, mode = 'cpu'] = process.argv.slice(2);
assert.ok(['cpu', 'memory', 'both'].includes(mode));
const cpuEnabled = mode !== 'memory';
const memoryEnabled = mode !== 'cpu';
assert.match(runId || '', /^[0-9a-f-]{36}$/);
for (const file of [output, stop]) {
  assert.equal(path.dirname(file), '/tmp');
  assert.ok(path.basename(file).startsWith(`ingestion-cpu-${runId}`));
}
async function main() {
  let targets;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      targets = await (
        await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(1000) })
      ).json();
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  const target = targets?.find(item => item.type === 'node');
  assert.ok(target, 'Owned Node inspector did not start');
  const url = new URL(target.webSocketDebuggerUrl);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '9229');
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Profiler command timed out'));
      }, 10000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  socket.addEventListener('message', message => {
    const response = JSON.parse(message.data);
    const request = pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(response.id);
    if (response.error) request.reject(new Error('Profiler command rejected'));
    else request.resolve(response.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  try {
    if (cpuEnabled) {
      await send('Profiler.enable');
      await send('Profiler.setSamplingInterval', { interval: 1000 });
      await send('Profiler.start');
    }
    const deadline = Date.now() + 180000;
    const memoryPath = `${output}.memory.jsonl`;
    const gcKey = `opsknight-memory-${runId}`;
    if (memoryEnabled)
      await send('Runtime.evaluate', {
        expression: `(() => { try {
        const { PerformanceObserver, constants } = process.mainModule.require('node:perf_hooks');
        const state = { count: 0, durationMs: 0, maxDurationMs: 0, majorCount: 0, majorDurationMs: 0 };
        const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) {
          state.count++; state.durationMs += entry.duration;
          state.maxDurationMs = Math.max(state.maxDurationMs, entry.duration);
          if (entry.detail?.kind === constants.NODE_PERFORMANCE_GC_MAJOR) {
            state.majorCount++; state.majorDurationMs += entry.duration;
          }
        }});
        observer.observe({ entryTypes: ['gc'] });
        globalThis[Symbol.for('${gcKey}')] = { state, observer };
        return true;
      } catch { return false; } })()`,
        returnByValue: true,
      });
    if (memoryEnabled) fs.writeFileSync(memoryPath, '', { mode: 0o600 });
    fs.writeFileSync(`${output}.ready`, 'ready');
    while (!fs.existsSync(stop) && Date.now() < deadline) {
      if (memoryEnabled) {
        const result = await send('Runtime.evaluate', {
          expression: `JSON.stringify({observedAt:Date.now(),...process.memoryUsage(),gc:globalThis[Symbol.for('${gcKey}')]?.state ?? null})`,
          returnByValue: true,
        });
        assert.equal(result.result.type, 'string');
        const memory = JSON.parse(result.result.value);
        fs.appendFileSync(
          memoryPath,
          JSON.stringify({
            ...memory,
            cgroup: (() => {
              const read = file => fs.readFileSync('/sys/fs/cgroup/' + file, 'utf8').trim();
              const counters = file =>
                Object.fromEntries(
                  read(file)
                    .split('\n')
                    .map(line => {
                      const [key, value] = line.split(/\s+/);
                      return [key, Number(value)];
                    })
                );
              return {
                currentBytes: Number(read('memory.current')),
                peakBytes: Number(read('memory.peak')),
                events: counters('memory.events'),
                cpu: counters('cpu.stat'),
                stat: counters('memory.stat'),
              };
            })(),
          }) + '\n'
        );
      }
      await new Promise(resolve => setTimeout(resolve, memoryEnabled ? 500 : 100));
    }
    if (memoryEnabled)
      await send('Runtime.evaluate', {
        expression: `(() => { const key=Symbol.for('${gcKey}'); globalThis[key]?.observer.disconnect(); delete globalThis[key]; })()`,
      });
    if (cpuEnabled) {
      const { profile } = await send('Profiler.stop');
      fs.writeFileSync(output, JSON.stringify(profile));
    } else
      fs.writeFileSync(output, JSON.stringify({ memoryOnly: true, certifiedEnterprise: false }));
  } finally {
    socket.close();
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
