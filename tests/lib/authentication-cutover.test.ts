// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
// The production image packages this exact dependency-free Node script.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkCutover } = require('../../scripts/check-authentication-cutover.cjs') as {
  checkCutover: (input: {
    deployments: string[];
    getDeployment: (name: string) => Promise<unknown>;
    listPods: () => Promise<unknown[]>;
    listDeployments?: () => Promise<unknown[]>;
  }) => Promise<void>;
};
const stopped = {
  spec: { replicas: 0, selector: { matchLabels: { release: 'sso', component: 'web' } } },
};
describe('pre-migration authentication cutover gate', () => {
  it('blocks live Deployments even before their pods appear', async () => {
    const listPods = vi.fn().mockResolvedValue([]);
    await expect(
      checkCutover({
        deployments: ['web'],
        getDeployment: async () => ({ ...stopped, spec: { ...stopped.spec, replicas: 1 } }),
        listPods,
      })
    ).rejects.toThrow('replicas must be zero');
    expect(listPods).not.toHaveBeenCalled();
  });
  it.each(['Running', 'Pending', undefined])(
    'blocks remaining %s pods even after desired replicas are zero',
    async phase => {
      await expect(
        checkCutover({
          deployments: ['web'],
          getDeployment: async () => stopped,
          listPods: async () => [
            {
              metadata: {
                labels: { release: 'sso', component: 'web' },
                deletionTimestamp: new Date().toISOString(),
              },
              status: { phase },
            },
          ],
        })
      ).rejects.toThrow('pods are still present');
    }
  );
  it('permits a stopped integrated/split runtime while leaving infrastructure and completed jobs alone', async () => {
    await expect(
      checkCutover({
        deployments: ['web', 'absent'],
        getDeployment: async name => (name === 'absent' ? null : stopped),
        listPods: async () => [
          {
            metadata: { labels: { release: 'sso', component: 'database' } },
            status: { phase: 'Running' },
          },
          {
            metadata: { labels: { release: 'sso', component: 'web' } },
            status: { phase: 'Succeeded' },
          },
        ],
      })
    ).resolves.toBeUndefined();
  });
  it('also blocks renamed Deployments from the release inventory', async () => {
    await expect(
      checkCutover({
        deployments: ['web'],
        getDeployment: async () => null,
        listPods: async () => [],
        listDeployments: async () => [
          { ...stopped, metadata: { name: 'renamed-web' }, spec: { ...stopped.spec, replicas: 1 } },
        ],
      })
    ).rejects.toThrow('replicas must be zero');
  });
  it('keeps correctly classified PgBouncer running while verifying all application roles are stopped', async () => {
    await expect(
      checkCutover({
        deployments: ['web'],
        getDeployment: async () => stopped,
        listDeployments: async () => [
          {
            metadata: { name: 'pooler', labels: { 'app.kubernetes.io/component': 'pgbouncer' } },
            spec: { replicas: 2 },
          },
        ],
        listPods: async () => [
          {
            metadata: { labels: { release: 'sso', component: 'pgbouncer' } },
            status: { phase: 'Running' },
          },
        ],
      })
    ).resolves.toBeUndefined();
  });
  it('propagates API failure instead of declaring the release safe', async () => {
    await expect(
      checkCutover({
        deployments: ['web'],
        getDeployment: async () => {
          throw new Error('API unavailable');
        },
        listPods: async () => [],
      })
    ).rejects.toThrow('API unavailable');
  });
});
