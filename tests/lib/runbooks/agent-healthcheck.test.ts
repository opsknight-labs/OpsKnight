// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))
  );
});
async function check(state?: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'opsknight-agent-health-'));
  directories.push(directory);
  // The directory is exclusively created by mkdtemp above, never supplied externally.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (state !== undefined) await writeFile(join(directory, 'health.json'), JSON.stringify(state));
  return spawnSync(process.execPath, ['agent/healthcheck.mjs'], {
    env: { ...process.env, OPSKNIGHT_AGENT_DATA_DIR: directory },
  }).status;
}
describe('Agent local healthcheck', () => {
  it('accepts initialized live local progress without contacting OpsKnight', async () => {
    expect(await check({ pid: process.pid, updatedAt: Date.now(), ready: true })).toBe(0);
  });
  it('rejects absent, stale, future, uninitialized and malformed progress', async () => {
    expect(await check()).toBe(1);
    for (const state of [
      { pid: process.pid, updatedAt: Date.now() - 100_000, ready: true },
      { pid: process.pid, updatedAt: Date.now() + 100_000, ready: true },
      { pid: process.pid, updatedAt: Date.now(), ready: false },
      { pid: 0, updatedAt: Date.now(), ready: true },
      null,
    ])
      expect(await check(state)).toBe(1);
  });
});
