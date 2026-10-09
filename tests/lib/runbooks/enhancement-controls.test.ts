// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { compareEvidence, runbookEvidenceSchema } from '@/lib/runbooks/evidence';
import { parseRunbookDefinition } from '@/lib/runbooks/definition';
import { schedulingLabelsSchema } from '@/lib/runbooks/labels';
import { commandFor, executeAttempt, containerHealthPassed } from '../../../agent/src/executor';
import { assertPolicyAllows, DEFAULT_POLICY } from '../../../agent/src/policy';
import {
  canonicalEnvelope,
  parseTrustedSigningKeys,
  verifyExecutionEnvelope,
} from '../../../agent/src/envelope';
import type { AgentPolicy, ClaimedAttempt } from '../../../agent/src/types';
import { probeCapabilities } from '../../../agent/src/capabilities';
import { containerEvidenceFormat } from '../../../agent/src/evidence';
import { runbookPageQuery } from '@/components/runbooks/RunbookPagination';

const stamp = { capturedAt: new Date().toISOString() };
const policy: AgentPolicy = {
  ...DEFAULT_POLICY,
  allowedStepTypes: ['LINUX_DIAGNOSTICS', 'SYSTEMD', 'DOCKER', 'KUBERNETES'],
  linuxDiagnostics: ['summary', 'disk', 'memory', 'http', 'tcp', 'dns'],
  systemdUnits: ['payments.service'],
  dockerContainers: ['payments'],
  podmanContainers: ['pod-payments'],
  kubernetesNamespaces: ['payments'],
  kubernetesActions: ['get', 'events', 'scale', 'rollout-status', 'logs'],
  kubernetesMaxReplicas: 5,
  networkHosts: ['127.0.0.1'],
  networkPorts: [80],
};
function attempt(
  type: ClaimedAttempt['step']['type'],
  config: Record<string, unknown>,
  riskClass: ClaimedAttempt['step']['riskClass'] = 'READ_ONLY'
): ClaimedAttempt {
  return {
    attemptId: 'attempt',
    executionId: 'execution',
    leaseToken: 'lease',
    leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    inputValues: {},
    secretInputKeys: [],
    idempotencyKey: null,
    planDigest: null,
    step: { key: 'check', name: 'Check', type, riskClass, config, timeoutSeconds: 5 },
  };
}
describe('runbook enhancement safety', () => {
  it('validates date filters, bounds pages and ignores duplicate or oversized query parameters', () => {
    expect(
      runbookPageQuery({
        page: '-1',
        from: '2026-02-30',
        to: '2026-10-04T12:00:00Z',
        q: ['one', 'two'],
      })
    ).toEqual({ page: 1, query: { page: '-1' } });
    expect(
      runbookPageQuery({ page: '2', from: '2026-10-01', to: '2026-10-04', q: 'payments' }).page
    ).toBe(2);
    expect(runbookPageQuery({ page: '10001', q: 'x'.repeat(201) }).query.q).toBeUndefined();
  });
  it('advertises runtime access, not merely configured executors, and distinguishes Podman', async () => {
    const probe = async (command: string) => {
      if (command !== 'podman') throw new Error('Permission denied');
    };
    const result = await probeCapabilities(policy, probe);
    expect(result.capabilities).toContain('RUNBOOK_PODMAN');
    expect(result.capabilities).toContain('RUNBOOK_DOCKER');
    expect(result.capabilities).not.toContain('RUNBOOK_DOCKER_RUNTIME');
    expect(result.capabilities).not.toContain('RUNBOOK_SYSTEMD');
    expect(result.report.find(item => item.name === 'Systemd')).toMatchObject({
      configured: true,
      available: false,
    });
    const disabled = await probeCapabilities(DEFAULT_POLICY, async () => {
      throw new Error('Disabled executors must not be probed');
    });
    expect(disabled.report.find(item => item.name === 'Podman')).toMatchObject({
      configured: false,
      available: false,
    });
  });
  it('requires positive healthy evidence, not command exit or metrics alone', () => {
    expect(compareEvidence(stamp, { ...stamp, cpu: { load1: 0, cores: 1 } }).healthy).toBe(false);
    expect(compareEvidence(stamp, { ...stamp, serviceState: 'active' }).healthy).toBe(true);
    expect(
      compareEvidence(stamp, {
        ...stamp,
        serviceState: 'failed',
        healthChecks: [{ url: 'http://private', status: 200, healthy: true }],
      }).healthy
    ).toBe(false);
    expect(
      compareEvidence(stamp, { ...stamp, serviceState: 'active', captureError: 'missing' }).healthy
    ).toBe(false);
    expect(compareEvidence(stamp, { ...stamp, serviceState: 'active' }).differences).toContainEqual(
      { field: 'serviceState', before: 'Not captured', after: 'active' }
    );
  });
  it('requires healthy container runtime state and converged Kubernetes generation', () => {
    for (const name of ['Health', 'Healthcheck']) {
      expect(
        compareEvidence(stamp, {
          ...stamp,
          containerState: JSON.stringify({ Running: true, [name]: { Status: 'unhealthy' } }),
        }).healthy
      ).toBe(false);
      expect(
        compareEvidence(stamp, {
          ...stamp,
          containerState: JSON.stringify({ Running: true, [name]: { Status: 'healthy' } }),
        }).healthy
      ).toBe(true);
    }
    expect(
      compareEvidence(stamp, {
        ...stamp,
        containerState: JSON.stringify({ Running: true, Paused: true }),
      }).healthy
    ).toBe(false);
    expect(containerHealthPassed('{"Status":"healthy"}')).toBe(true);
    expect(containerHealthPassed('"healthy"')).toBe(true);
    expect(containerEvidenceFormat('podman')).toContain('.State.Healthcheck.Status');
    expect(containerEvidenceFormat('docker')).toContain('.State.Health.Status');
    expect(containerEvidenceFormat('podman')).not.toContain('.Log');
    for (const health of [
      'null',
      '{}',
      '{"Status":"unhealthy"}',
      '{"Status":"starting"}',
      'not-json',
    ])
      expect(containerHealthPassed(health)).toBe(false);
    expect(
      compareEvidence(stamp, {
        ...stamp,
        containerState: JSON.stringify({ Running: true, Health: { Status: 'healthy' } }),
      }).healthy
    ).toBe(true);
    expect(
      compareEvidence(stamp, {
        ...stamp,
        containerState: JSON.stringify({ Running: true, Health: { Status: 'unhealthy' } }),
        serviceState: 'active',
      }).healthy
    ).toBe(false);
    expect(
      compareEvidence(stamp, {
        ...stamp,
        kubernetesState: { desired: 3, ready: 3, generation: 2, observedGeneration: 1 },
      }).healthy
    ).toBe(false);
    expect(
      compareEvidence(stamp, {
        ...stamp,
        kubernetesState: { desired: 3, ready: 3, generation: 2, observedGeneration: 2 },
      }).healthy
    ).toBe(true);
    expect(
      runbookEvidenceSchema.safeParse({ ...stamp, logSummary: 'x'.repeat(4097) }).success
    ).toBe(false);
  });
  it('builds bounded argv diagnostics and independently allowlists Podman', () => {
    expect(
      commandFor(attempt('SYSTEMD', { action: 'logs', unit: 'payments.service', lines: 9000 }))
    ).toEqual({
      command: 'journalctl',
      args: ['--no-pager', '--unit', 'payments.service', '--lines', '500'],
    });
    expect(
      commandFor(
        attempt('DOCKER', { action: 'health', runtime: 'podman', container: 'pod-payments' })
      ).command
    ).toBe('podman');
    expect(() =>
      assertPolicyAllows(attempt('DOCKER', { runtime: 'podman', container: 'payments' }), policy)
    ).toThrow('LOCAL_POLICY_DENIED');
    expect(() =>
      assertPolicyAllows(
        attempt('DOCKER', { runtime: 'podman', container: 'pod-payments' }),
        policy
      )
    ).not.toThrow();
    expect(
      commandFor(attempt('LINUX_DIAGNOSTICS', { diagnostic: 'process', pattern: '-bad; shell' }))
        .args
    ).toEqual(['-a', '-f', '--', '-bad; shell']);
  });
  it('enforces Kubernetes namespace, action, replica bounds and write risk', () => {
    const scale = attempt(
      'KUBERNETES',
      { action: 'scale', namespace: 'payments', resource: 'deployment', name: 'api', replicas: 3 },
      'IDEMPOTENT_WRITE'
    );
    expect(commandFor(scale).args).toEqual([
      '-n',
      'payments',
      'scale',
      'deployment/api',
      '--replicas=3',
    ]);
    expect(() => assertPolicyAllows(scale, policy)).not.toThrow();
    expect(() =>
      assertPolicyAllows(
        { ...scale, step: { ...scale.step, config: { ...scale.step.config, replicas: 6 } } },
        policy
      )
    ).toThrow('replica limit');
    expect(() =>
      parseRunbookDefinition({ steps: [{ ...scale.step, riskClass: 'READ_ONLY' }] })
    ).toThrow('IDEMPOTENT_WRITE');

    // Kubernetes logs syntax with --limit-bytes and --tail
    const podLogs = attempt('KUBERNETES', {
      action: 'logs',
      namespace: 'payments',
      resource: 'pods',
      name: 'api-pod-1',
    });
    expect(commandFor(podLogs).args).toEqual([
      '-n',
      'payments',
      'logs',
      'api-pod-1',
      '--tail=500',
      '--limit-bytes=262144',
    ]);

    const deployLogs = attempt('KUBERNETES', {
      action: 'logs',
      namespace: 'payments',
      resource: 'deployment',
      name: 'api',
    });
    expect(commandFor(deployLogs).args).toEqual([
      '-n',
      'payments',
      'logs',
      'deployment/api',
      '--tail=500',
      '--limit-bytes=262144',
    ]);

    // Kubernetes events: namespace-wide without name, field-selector with name
    const allEvents = attempt('KUBERNETES', { action: 'events', namespace: 'payments' });
    expect(commandFor(allEvents).args).toEqual(['-n', 'payments', 'get', 'events']);

    const namedEvents = attempt('KUBERNETES', {
      action: 'events',
      namespace: 'payments',
      name: 'api',
    });
    expect(commandFor(namedEvents).args).toEqual([
      '-n',
      'payments',
      'get',
      'events',
      '--field-selector',
      'involvedObject.name=api,involvedObject.kind=Pod',
    ]);

    const deployEvents = attempt('KUBERNETES', {
      action: 'events',
      namespace: 'payments',
      resource: 'deployments',
      name: 'api',
    });
    expect(commandFor(deployEvents).args).toEqual([
      '-n',
      'payments',
      'get',
      'events',
      '--field-selector',
      'involvedObject.name=api,involvedObject.kind=Deployment',
    ]);

    const statefulEvents = attempt('KUBERNETES', {
      action: 'events',
      namespace: 'payments',
      resource: 'statefulset',
      name: 'db',
    });
    expect(commandFor(statefulEvents).args).toEqual([
      '-n',
      'payments',
      'get',
      'events',
      '--field-selector',
      'involvedObject.name=db,involvedObject.kind=StatefulSet',
    ]);
  });
  it('enforces fine-grained kubernetesTargets local policy when configured', () => {
    const fineGrainedPolicy: AgentPolicy = {
      ...policy,
      kubernetesTargets: [
        {
          namespace: 'payments',
          resources: ['deployment'],
          names: ['api'],
          actions: ['scale'],
          maxReplicas: 3,
        },
      ],
    };
    const allowedScale = attempt(
      'KUBERNETES',
      { action: 'scale', namespace: 'payments', resource: 'deployment', name: 'api', replicas: 3 },
      'IDEMPOTENT_WRITE'
    );
    expect(() => assertPolicyAllows(allowedScale, fineGrainedPolicy)).not.toThrow();

    const deniedName = attempt(
      'KUBERNETES',
      { action: 'scale', namespace: 'payments', resource: 'deployment', name: 'worker', replicas: 3 },
      'IDEMPOTENT_WRITE'
    );
    expect(() => assertPolicyAllows(deniedName, fineGrainedPolicy)).toThrow(
      'not allowlisted by local agent target policies'
    );

    const deniedReplicas = attempt(
      'KUBERNETES',
      { action: 'scale', namespace: 'payments', resource: 'deployment', name: 'api', replicas: 4 },
      'IDEMPOTENT_WRITE'
    );
    expect(() => assertPolicyAllows(deniedReplicas, fineGrainedPolicy)).toThrow(
      'not allowlisted by local agent target policies'
    );

    const omittedNameWhenNamesConfigured = attempt(
      'KUBERNETES',
      { action: 'scale', namespace: 'payments', resource: 'deployment', replicas: 2 },
      'IDEMPOTENT_WRITE'
    );
    expect(() => assertPolicyAllows(omittedNameWhenNamesConfigured, fineGrainedPolicy)).toThrow(
      'not allowlisted by local agent target policies'
    );

    const policyWithoutTargetMaxReplicas: AgentPolicy = {
      ...policy,
      kubernetesMaxReplicas: 3,
      kubernetesTargets: [
        {
          namespace: 'payments',
          resources: ['deployment'],
          names: ['api'],
          actions: ['scale'],
        },
      ],
    };
    const allowedFallback = attempt(
      'KUBERNETES',
      { action: 'scale', namespace: 'payments', resource: 'deployment', name: 'api', replicas: 3 },
      'IDEMPOTENT_WRITE'
    );
    expect(() => assertPolicyAllows(allowedFallback, policyWithoutTargetMaxReplicas)).not.toThrow();

    const deniedFallback = attempt(
      'KUBERNETES',
      { action: 'scale', namespace: 'payments', resource: 'deployment', name: 'api', replicas: 4 },
      'IDEMPOTENT_WRITE'
    );
    expect(() => assertPolicyAllows(deniedFallback, policyWithoutTargetMaxReplicas)).toThrow(
      'not allowlisted by local agent target policies'
    );

    const policyWithZeroMaxReplicas: AgentPolicy = {
      ...policy,
      kubernetesMaxReplicas: 0,
      kubernetesTargets: [
        {
          namespace: 'payments',
          resources: ['deployment'],
          names: ['api'],
          actions: ['scale'],
        },
      ],
    };
    const deniedZeroMax = attempt(
      'KUBERNETES',
      { action: 'scale', namespace: 'payments', resource: 'deployment', name: 'api', replicas: 1 },
      'IDEMPOTENT_WRITE'
    );
    expect(() => assertPolicyAllows(deniedZeroMax, policyWithZeroMaxReplicas)).toThrow(
      'not allowlisted by local agent target policies'
    );

    const policyDenyingGlobalAction: AgentPolicy = {
      ...policy,
      kubernetesActions: ['get', 'describe'],
      kubernetesTargets: [
        {
          namespace: 'payments',
          resources: ['deployment'],
          names: ['api'],
          actions: ['scale'],
        },
      ],
    };
    expect(() => assertPolicyAllows(allowedScale, policyDenyingGlobalAction)).toThrow(
      'LOCAL_POLICY_DENIED: Kubernetes action is not allowlisted.'
    );
  });
  it('enforces linuxDiagnostics default allowlist of summary, disk, memory', () => {
    expect(() =>
      assertPolicyAllows(attempt('LINUX_DIAGNOSTICS', { diagnostic: 'processes' }), DEFAULT_POLICY)
    ).toThrow('LOCAL_POLICY_DENIED: Linux diagnostic processes is not allowlisted.');
    expect(() =>
      assertPolicyAllows(attempt('LINUX_DIAGNOSTICS', { diagnostic: 'summary' }), DEFAULT_POLICY)
    ).not.toThrow();
  });
  it('rejects network destinations and URL credentials unless locally permitted', () => {
    expect(() =>
      assertPolicyAllows(
        attempt('LINUX_DIAGNOSTICS', { diagnostic: 'http', url: 'http://169.254.169.254/' }),
        policy
      )
    ).toThrow('not allowlisted');
    expect(() =>
      assertPolicyAllows(
        attempt('LINUX_DIAGNOSTICS', { diagnostic: 'http', url: 'http://user:pass@127.0.0.1/' }),
        policy
      )
    ).toThrow('invalid diagnostic URL');
    expect(() =>
      assertPolicyAllows(
        attempt('LINUX_DIAGNOSTICS', { diagnostic: 'tcp', host: '127.0.0.1', port: 22 }),
        policy
      )
    ).toThrow('not allowlisted');
  });
  it('runs explicitly permitted private HTTP and TCP checks without following redirects', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/unhealthy') response.statusCode = 503;
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: 'http://169.254.169.254/' });
      }
      response.end('healthy');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local server port');
    const localPolicy = { ...policy, networkPorts: [address.port] };
    try {
      const result = await executeAttempt(
        attempt('LINUX_DIAGNOSTICS', {
          diagnostic: 'http',
          url: `http://127.0.0.1:${address.port}/`,
        }),
        localPolicy,
        new AbortController().signal
      );
      expect(result.status).toBe('SUCCEEDED');
      expect(compareEvidence(result.preState, result.postState).healthy).toBe(true);
      expect(
        (
          await executeAttempt(
            attempt('LINUX_DIAGNOSTICS', {
              diagnostic: 'tcp',
              host: '127.0.0.1',
              port: address.port,
            }),
            localPolicy,
            new AbortController().signal
          )
        ).status
      ).toBe('SUCCEEDED');
      expect(
        (
          await executeAttempt(
            attempt('LINUX_DIAGNOSTICS', {
              diagnostic: 'http',
              url: `http://127.0.0.1:${address.port}/redirect`,
            }),
            localPolicy,
            new AbortController().signal
          )
        ).status
      ).toBe('FAILED');
      const unhealthy = await executeAttempt(
        attempt('LINUX_DIAGNOSTICS', {
          diagnostic: 'http',
          url: `http://127.0.0.1:${address.port}/unhealthy`,
          expectedStatus: 503,
        }),
        localPolicy,
        new AbortController().signal
      );
      expect(unhealthy.status).toBe('SUCCEEDED');
      expect(compareEvidence(unhealthy.preState, unhealthy.postState).healthy).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });
  it('trusts overlapping identities by ID and rejects ID tampering or invalid configuration', () => {
    const old = generateKeyPairSync('ed25519');
    const next = generateKeyPairSync('ed25519');
    const pins = {
      old: old.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      next: next.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    };
    expect(parseTrustedSigningKeys(JSON.stringify(pins), undefined)).toEqual(pins);
    const legacyPayload = {
      signingAgentId: 'agent',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      executionDeadlineAt: new Date(Date.now() + 60000).toISOString(),
    };
    const legacy = {
      ...legacyPayload,
      signature: sign(null, Buffer.from(canonicalEnvelope(legacyPayload)), old.privateKey).toString(
        'base64'
      ),
    };
    expect(() =>
      verifyExecutionEnvelope(legacy, { default: pins.old, next: pins.next }, 'agent')
    ).not.toThrow();
    expect(() => verifyExecutionEnvelope(legacy, pins, 'agent')).toThrow('not trusted');
    for (const [id, privateKey] of [
      ['old', old.privateKey],
      ['next', next.privateKey],
    ] as const) {
      const payload = {
        signingKeyId: id,
        signingAgentId: 'agent',
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        executionDeadlineAt: new Date(Date.now() + 60000).toISOString(),
      };
      const signed = {
        ...payload,
        signature: sign(null, Buffer.from(canonicalEnvelope(payload)), privateKey).toString(
          'base64'
        ),
      };
      expect(() => verifyExecutionEnvelope(signed, pins, 'agent')).not.toThrow();
      expect(() =>
        verifyExecutionEnvelope({ ...signed, signingKeyId: 'unknown' }, pins, 'agent')
      ).toThrow('not trusted');
      expect(() =>
        verifyExecutionEnvelope(
          { ...signed, signingKeyId: id === 'old' ? 'next' : 'old' },
          pins,
          'agent'
        )
      ).toThrow('invalid');
    }
    for (const invalid of ['null', '[]', '{}', '{"old":"not-a-key"}'])
      expect(() => parseTrustedSigningKeys(invalid, undefined)).toThrow();
  });
  it('runs allowlisted DNS and never starts an already-cancelled lookup', async () => {
    const dnsPolicy = { ...policy, networkHosts: ['localhost'], networkPorts: [53] };
    const diagnostic = attempt('LINUX_DIAGNOSTICS', { diagnostic: 'dns', hostname: 'localhost' });
    expect((await executeAttempt(diagnostic, dnsPolicy, new AbortController().signal)).status).toBe(
      'SUCCEEDED'
    );
    const controller = new AbortController();
    controller.abort();
    expect((await executeAttempt(diagnostic, dnsPolicy, controller.signal)).status).toBe(
      'CANCELLED'
    );
  });
  it('bounds administrator scheduling labels', () => {
    expect(
      schedulingLabelsSchema.safeParse({ environment: 'prod', host: '${{ incident.labels.host }}' })
        .success
    ).toBe(true);
    expect(schedulingLabelsSchema.safeParse({ 'bad/key': 'value' }).success).toBe(false);
    expect(
      schedulingLabelsSchema.safeParse(
        Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`key${index}`, 'x']))
      ).success
    ).toBe(false);
  });
});
