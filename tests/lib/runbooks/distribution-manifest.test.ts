// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { agentReleaseManifestSchema, supportsServer } from '@/lib/runbooks/distribution-contract';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
it.each(['2.1.0', '2.1.0-rc.1'])(
  'builds a hash-bound manifest compatible only with the tested matching server %s',
  async version => {
    const directory = await mkdtemp(join(tmpdir(), 'rbe-release-manifest-'));
    directories.push(directory);
    await mkdir(join(directory, 'dist/agent'), { recursive: true });
    const installer = '#!/bin/sh\nexit 0\n';
    await writeFile(join(directory, 'dist/agent/install.sh'), installer);
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/build-agent-release-manifest.mjs')],
      {
        cwd: directory,
        env: {
          ...process.env,
          OPSKNIGHT_VERSION: version,
          OPSKNIGHT_AGENT_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
          OPSKNIGHT_REVISION: 'b'.repeat(40),
        },
      }
    );
    expect(result.status).toBe(0);
    const manifest = agentReleaseManifestSchema.parse(
      JSON.parse(await readFile(join(directory, 'dist/agent/agent-release-manifest.json'), 'utf8'))
    );
    expect(manifest.installer.sha256).toBe(createHash('sha256').update(installer).digest('hex'));
    expect(manifest.server).toEqual({ minimum: '2.1.0', maximumExclusive: '2.1.1' });
    expect(supportsServer(manifest, version)).toBe(true);
    expect(supportsServer(manifest, '2.1.1')).toBe(false);
  }
);
it('fails before generating metadata when the published image digest is unavailable', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/build-agent-release-manifest.mjs')],
    {
      env: {
        ...process.env,
        OPSKNIGHT_VERSION: '2.1.0',
        OPSKNIGHT_AGENT_IMAGE_DIGEST: '',
        OPSKNIGHT_REVISION: 'b'.repeat(40),
      },
    }
  );
  expect(result.status).not.toBe(0);
});
