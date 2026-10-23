// Diagnostic client copied into an owned certification container. Inspector is
// enabled only on that container's loopback interface and never published.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [runId, output, stop] = process.argv.slice(2);
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
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 1000 });
    await send('Profiler.start');
    fs.writeFileSync(`${output}.ready`, 'ready');
    const deadline = Date.now() + 180000;
    while (!fs.existsSync(stop) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 100));
    const { profile } = await send('Profiler.stop');
    fs.writeFileSync(output, JSON.stringify(profile));
  } finally {
    socket.close();
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
