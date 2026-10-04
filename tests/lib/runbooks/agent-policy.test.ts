import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPolicyAllows, loadPolicy } from '../../../agent/src/policy';
import { ResultSpool } from '../../../agent/src/spool';
import type { AgentPolicy, ClaimedAttempt } from '../../../agent/src/types';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))
  );
});

const policy: AgentPolicy = {
  allowedStepTypes: ['LINUX_DIAGNOSTICS', 'SYSTEMD', 'KUBERNETES', 'BASH'],
  allowNonIdempotent: false,
  systemdUnits: ['opsknight-*'],
  dockerContainers: [],
  kubernetesNamespaces: ['production'],
  bashCommandPatterns: ['uptime', 'journalctl -u opsknight.service'],
  maxRuntimeSeconds: 300,
  maxOutputBytes: 1_048_576,
};

function attempt(overrides: Partial<ClaimedAttempt['step']>): ClaimedAttempt {
  return {
    attemptId: 'attempt123',
    leaseToken: 'lease',
    leaseExpiresAt: new Date().toISOString(),
    idempotencyKey: null,
    planDigest: null,
    executionId: 'execution123',
    inputValues: {},
    secretInputKeys: [],
    step: {
      key: 'check',
      name: 'Check',
      type: 'LINUX_DIAGNOSTICS',
      riskClass: 'READ_ONLY',
      config: {},
      timeoutSeconds: 30,
      ...overrides,
    },
  };
}

describe('runbook Agent local policy', () => {
  it('fails closed for disabled step types, targets, and non-idempotent work', () => {
    expect(() => assertPolicyAllows(attempt({ type: 'DOCKER' }), policy)).toThrow(
      'LOCAL_POLICY_DENIED'
    );
    expect(() =>
      assertPolicyAllows(attempt({ type: 'SYSTEMD', config: { unit: 'ssh.service' } }), policy)
    ).toThrow('LOCAL_POLICY_DENIED');
    expect(() => assertPolicyAllows(attempt({ riskClass: 'NON_IDEMPOTENT' }), policy)).toThrow(
      'non-idempotent actions are disabled'
    );
  });

  it('allows only allowlisted wildcard prefixes and Kubernetes namespaces', () => {
    expect(() =>
      assertPolicyAllows(attempt({ type: 'SYSTEMD', config: { unit: 'opsknight-web' } }), policy)
    ).not.toThrow();
    expect(() =>
      assertPolicyAllows(
        attempt({ type: 'KUBERNETES', config: { namespace: 'production' } }),
        policy
      )
    ).not.toThrow();
    expect(() =>
      assertPolicyAllows(attempt({ type: 'KUBERNETES', config: { namespace: 'default' } }), policy)
    ).toThrow('LOCAL_POLICY_DENIED');
  });

  it('requires exact Bash commands and rejects appended shell operations', () => {
    expect(() =>
      assertPolicyAllows(attempt({ type: 'BASH', config: { command: 'uptime' } }), policy)
    ).not.toThrow();
    expect(() =>
      assertPolicyAllows(attempt({ type: 'BASH', config: { command: 'uptime; id' } }), policy)
    ).toThrow('LOCAL_POLICY_DENIED');
  });

  it('normalizes bounds and produces a stable policy hash', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsknight-policy-'));
    temporaryDirectories.push(directory);
    const file = join(directory, 'policy.json');
    await writeFile(
      file,
      JSON.stringify({
        allowedStepTypes: ['LINUX_DIAGNOSTICS'],
        maxRuntimeSeconds: 99_999,
        maxOutputBytes: 1,
      })
    );
    const first = await loadPolicy(file);
    const second = await loadPolicy(file);
    expect(first.policy.maxRuntimeSeconds).toBe(3600);
    expect(first.policy.maxOutputBytes).toBe(1024);
    expect(first.hash).toBe(second.hash);
  });

  it('rejects malformed limits, booleans, and unknown step types', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsknight-policy-'));
    temporaryDirectories.push(directory);
    const file = join(directory, 'policy.json');
    await writeFile(file, JSON.stringify({ maxRuntimeSeconds: '300' }));
    await expect(loadPolicy(file)).rejects.toThrow('finite integers');
    await writeFile(file, JSON.stringify({ allowNonIdempotent: 'false' }));
    await expect(loadPolicy(file)).rejects.toThrow('must be a boolean');
    await writeFile(file, JSON.stringify({ allowedStepTypes: ['REMOTE_CODE'] }));
    await expect(loadPolicy(file)).rejects.toThrow('unsupported step type');
  });
});

describe('runbook Agent result spool', () => {
  it('atomically persists, restores, replaces, and removes result records', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsknight-spool-'));
    temporaryDirectories.push(directory);
    const spool = new ResultSpool(directory);
    await spool.put({
      attemptId: 'attempt123',
      leaseToken: 'lease',
      producedAt: '2026-10-04T00:00:00.000Z',
      status: 'FAILED',
      errorCode: 'FIRST',
    });
    await spool.put({
      attemptId: 'attempt123',
      leaseToken: 'lease',
      producedAt: '2026-10-04T00:00:01.000Z',
      status: 'SUCCEEDED',
      outputPreview: 'done',
    });
    expect(await spool.depth()).toBe(1);
    expect(await spool.list()).toEqual([
      {
        attemptId: 'attempt123',
        leaseToken: 'lease',
        producedAt: '2026-10-04T00:00:01.000Z',
        status: 'SUCCEEDED',
        outputPreview: 'done',
      },
    ]);
    await spool.remove('attempt123');
    expect(await spool.depth()).toBe(0);
  });

  it('rejects path traversal in attempt IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsknight-spool-'));
    temporaryDirectories.push(directory);
    const spool = new ResultSpool(directory);
    await expect(
      spool.put({
        attemptId: '../escape',
        leaseToken: 'lease',
        producedAt: '2026-10-04T00:00:00.000Z',
        status: 'FAILED',
      })
    ).rejects.toThrow('Invalid attempt ID');
  });
});
