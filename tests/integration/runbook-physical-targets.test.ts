// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeAttempt } from '../../agent/src/executor';
import { DEFAULT_POLICY } from '../../agent/src/policy';
import { sanitizeOutputText } from '../../agent/src/output-safety';
import type { ClaimedAttempt, AgentPolicy } from '../../agent/src/types';
const run = promisify(execFile);
const suite = process.env.RUNBOOK_PHYSICAL_TARGETS === 'true' ? describe : describe.skip;
const command = (name: string, args: string[]) =>
  run(name, args, { timeout: 180000, maxBuffer: 1024 * 1024 });
function attempt(
  type: 'DOCKER' | 'KUBERNETES',
  config: Record<string, unknown>,
  riskClass: ClaimedAttempt['step']['riskClass']
): ClaimedAttempt {
  return {
    attemptId: crypto.randomUUID(),
    executionId: crypto.randomUUID(),
    leaseToken: 'isolated-fixture',
    leaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
    executionDeadlineAt: new Date(Date.now() + 120000).toISOString(),
    inputValues: {},
    secretInputKeys: [],
    idempotencyKey: crypto.randomUUID(),
    planDigest: null,
    step: {
      key: 'fixture',
      name: 'Disposable target',
      type,
      riskClass,
      config,
      timeoutSeconds: 60,
    },
  };
}
suite('disposable physical Agent executor targets (not HA or release certification)', () => {
  it('performs real Docker start/stop/restart and Kubernetes scale/restart with independent state checks', async () => {
    const id = `rbe-physical-${crypto.randomUUID().slice(0, 8)}`;
    const dir = await mkdtemp(join(tmpdir(), 'rbe-physical-'));
    const contextBefore = process.env.KUBECONFIG;
    const evidence: unknown[] = [];
    let clusterCreated = false;
    const policy: AgentPolicy = {
      ...DEFAULT_POLICY,
      allowedStepTypes: ['DOCKER', 'KUBERNETES'],
      dockerContainers: [id],
      kubernetesNamespaces: [id],
      kubernetesActions: ['get', 'scale', 'rollout-restart', 'rollout-status'],
      kubernetesMaxReplicas: 2,
      allowNonIdempotent: true,
      maxRuntimeSeconds: 90,
    };
    try {
      await command('docker', [
        'run',
        '-d',
        '--name',
        id,
        '--label',
        'opsknight.certification=runbook-enterprise',
        '--env',
        'INTERNAL_PASSWORD=fixture-credential-must-not-leak',
        'busybox:1.37.0',
        'sleep',
        '900',
      ]);
      for (const [action, running] of [
        ['stop', false],
        ['start', true],
        ['restart', true],
      ] as const) {
        const result = await executeAttempt(
          attempt(
            'DOCKER',
            { action, container: id },
            action === 'restart' ? 'NON_IDEMPOTENT' : 'IDEMPOTENT_WRITE'
          ),
          policy,
          new AbortController().signal
        );
        expect(result.status).toBe('SUCCEEDED');
        expect(
          (await command('docker', ['inspect', '--format', '{{.State.Running}}', id])).stdout.trim()
        ).toBe(String(running));
        evidence.push({
          platform: 'docker',
          action,
          status: result.status,
          preState: result.preState,
          postState: result.postState,
          independentlyRunning: running,
        });
      }
      const inspected = await executeAttempt(
        attempt('DOCKER', { action: 'inspect', container: id }, 'READ_ONLY'),
        policy,
        new AbortController().signal
      );
      expect(inspected.output).not.toContain('fixture-credential-must-not-leak');
      process.env.KUBECONFIG = join(dir, 'kubeconfig');
      clusterCreated = true;
      await command('kind', [
        'create',
        'cluster',
        '--name',
        id,
        '--kubeconfig',
        process.env.KUBECONFIG,
        '--wait',
        '120s',
      ]);
      await command('kind', ['load', 'docker-image', 'busybox:1.37.0', '--name', id]);
      await command('kubectl', ['create', 'namespace', id]);
      await command('kubectl', [
        '-n',
        id,
        'create',
        'deployment',
        id,
        '--image=busybox:1.37.0',
        '--',
        'sleep',
        '900',
      ]);
      await command('kubectl', [
        '-n',
        id,
        'rollout',
        'status',
        `deployment/${id}`,
        '--timeout=120s',
      ]);
      for (const replicas of [2, 1]) {
        const result = await executeAttempt(
          attempt(
            'KUBERNETES',
            { action: 'scale', namespace: id, resource: 'deployment', name: id, replicas },
            'IDEMPOTENT_WRITE'
          ),
          policy,
          new AbortController().signal
        );
        expect(result.status).toBe('SUCCEEDED');
        await command('kubectl', [
          '-n',
          id,
          'rollout',
          'status',
          `deployment/${id}`,
          '--timeout=120s',
        ]);
        const observed = JSON.parse(
          (await command('kubectl', ['-n', id, 'get', 'deployment', id, '-o', 'json'])).stdout
        ) as { status: { readyReplicas?: number }; spec: { replicas: number } };
        expect(observed.spec.replicas).toBe(replicas);
        expect(observed.status.readyReplicas).toBe(replicas);
        evidence.push({
          platform: 'kubernetes',
          action: 'scale',
          replicas,
          status: result.status,
          preState: result.preState,
          postState: result.postState,
          independentlyReadyReplicas: observed.status.readyReplicas,
        });
      }
      const restarted = await executeAttempt(
        attempt(
          'KUBERNETES',
          { action: 'rollout-restart', namespace: id, resource: 'deployment', name: id },
          'NON_IDEMPOTENT'
        ),
        policy,
        new AbortController().signal
      );
      expect(restarted.status).toBe('SUCCEEDED');
      await command('kubectl', [
        '-n',
        id,
        'rollout',
        'status',
        `deployment/${id}`,
        '--timeout=120s',
      ]);
      evidence.push({
        platform: 'kubernetes',
        action: 'rollout-restart',
        status: restarted.status,
        independentlyConverged: true,
      });
      // Evidence path is explicitly configured by the operator/CI, never a remote Agent payload.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await writeFile(
        process.env.RUNBOOK_PHYSICAL_EVIDENCE ?? join(dir, 'physical-targets.json'),
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            sourceRevision: process.env.GITHUB_SHA ?? null,
            evidence,
            limitations: [
              'Direct executor tests; protocol authorization covered separately',
              'Single-node Kind and Docker daemon',
              'No native Systemd/Podman, node/database failover or released upgrade certification',
            ],
          },
          null,
          2
        )
      );
    } finally {
      await command('docker', ['rm', '-f', id]).catch(() => undefined);
      if (clusterCreated)
        await command('kind', ['delete', 'cluster', '--name', id]).catch(() => undefined);
      if (contextBefore === undefined) delete process.env.KUBECONFIG;
      else process.env.KUBECONFIG = contextBefore;
      await rm(dir, { recursive: true, force: true });
    }
    expect(sanitizeOutputText(JSON.stringify(evidence))).not.toContain(
      'fixture-credential-must-not-leak'
    );
  }, 900000);
});
