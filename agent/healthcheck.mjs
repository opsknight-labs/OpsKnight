import { readFile } from 'node:fs/promises';
import { uptime } from 'node:os';

// Local progress only: control-plane outages must not trigger restart loops.
try {
  const mode = process.argv[2] ?? 'readiness';
  if (!['startup', 'liveness', 'readiness'].includes(mode)) throw new Error('Unknown probe mode.');
  const directory = process.env.OPSKNIGHT_AGENT_DATA_DIR ?? '/var/lib/opsknight-agent';
  const file = process.env.OPSKNIGHT_AGENT_HEALTH_FILE ?? `${directory}/health.json`;
  const state = JSON.parse(await readFile(file, 'utf8'));
  const age = Number.isFinite(state.monotonicUpdatedAt)
    ? (uptime() - state.monotonicUpdatedAt) * 1000
    : Date.now() - state.updatedAt;
  if (
    !Number.isInteger(state.pid) ||
    state.pid <= 0 ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 90_000 ||
    (mode === 'readiness' && state.ready !== true) ||
    (mode === 'startup' && state.initialized !== true && state.ready !== true)
  ) {
    throw new Error('Agent has not initialized or local progress is stale.');
  }
  process.kill(state.pid, 0);
} catch (error) {
  process.stderr.write(
    `Agent ${process.argv[2] ?? 'readiness'} probe failed: ${error instanceof Error ? error.message : 'Invalid health state'}\n`
  );
  process.exitCode = 1;
}
