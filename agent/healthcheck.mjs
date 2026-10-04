import { readFile } from 'node:fs/promises';

// Local progress only: control-plane outages must not trigger restart loops.
try {
  const directory = process.env.OPSKNIGHT_AGENT_DATA_DIR ?? '/var/lib/opsknight-agent';
  const state = JSON.parse(await readFile(`${directory}/health.json`, 'utf8'));
  const age = Date.now() - state.updatedAt;
  if (
    !Number.isInteger(state.pid) ||
    state.pid <= 0 ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 90_000 ||
    state.ready !== true
  ) {
    throw new Error('Agent has not initialized or local progress is stale.');
  }
  process.kill(state.pid, 0);
} catch {
  process.exitCode = 1;
}
