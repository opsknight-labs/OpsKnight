/* eslint-disable @typescript-eslint/no-require-imports -- Executable CommonJS certification diagnostics. */
const assert = require('node:assert/strict');
function parseCounters(text) {
  return Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map(line => {
        const [key, value] = line.trim().split(/\s+/);
        const number = Number(value);
        assert.ok(key && Number.isFinite(number) && number >= 0, 'Invalid cgroup counter');
        return [key, number];
      })
  );
}
module.exports = async function databaseResources(invoke, container) {
  const files = ['cpu.stat', 'memory.current', 'memory.peak', 'memory.events'];
  const [cpu, current, peak, events, memory] = await Promise.all([
    ...files.map(file => invoke(['exec', container, 'cat', '/sys/fs/cgroup/' + file])),
    invoke(['exec', container, 'cat', '/proc/meminfo']),
  ]);
  const vmMemoryKiB = Object.fromEntries(
    memory
      .split('\n')
      .filter(line => /^(MemTotal|MemAvailable|SwapTotal|SwapFree):/.test(line))
      .map(line => {
        const [key, value] = line.split(/:\s*/);
        return [key, Number.parseInt(value, 10)];
      })
  );
  assert.ok(Number.isFinite(Number(current)) && Number(current) >= 0, 'Invalid current memory');
  assert.ok(Number.isFinite(Number(peak)) && Number(peak) >= 0, 'Invalid peak memory');
  return {
    observedAt: new Date().toISOString(),
    cpu: parseCounters(cpu),
    memoryCurrentBytes: Number(current),
    memoryPeakBytes: Number(peak),
    memoryEvents: parseCounters(events),
    vmMemoryKiB,
    scope:
      'Owned PostgreSQL cgroup counters; /proc/meminfo is shared Docker VM memory, not PostgreSQL RSS. CPU deltas include all owned fixture DBs.',
  };
};
module.exports.parseCounters = parseCounters;
