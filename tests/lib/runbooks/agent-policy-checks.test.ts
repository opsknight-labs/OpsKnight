import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, it } from 'vitest';
import { evaluatePolicyCheck, type PolicyCheckEnvelope } from '../../../agent/src/policy-checks';
import { canonicalEnvelope } from '../../../agent/src/envelope';
const keys = generateKeyPairSync('ed25519');
const pin = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
function envelope(): PolicyCheckEnvelope {
  const body = {
    kind: 'POLICY_CHECK' as const,
    id: crypto.randomUUID(),
    signingAgentId: 'agent',
    executionDeadlineAt: new Date(Date.now() + 60000).toISOString(),
    leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    steps: [
      {
        key: 'diagnose',
        name: 'Summary',
        type: 'LINUX_DIAGNOSTICS' as const,
        riskClass: 'READ_ONLY' as const,
        timeoutSeconds: 10,
        config: { action: 'summary' },
      },
      {
        key: 'write',
        name: 'Forbidden',
        type: 'BASH' as const,
        riskClass: 'NON_IDEMPOTENT' as const,
        timeoutSeconds: 10,
        config: { command: 'touch /tmp/forbidden-policy-check' },
      },
    ],
  };
  return {
    ...body,
    signature: sign(null, Buffer.from(canonicalEnvelope(body)), keys.privateKey).toString('base64'),
  };
}
it('reports policy decisions without running any command or granting permission', () => {
  const result = evaluatePolicyCheck(
    envelope(),
    {
      allowedStepTypes: ['LINUX_DIAGNOSTICS'],
      linuxDiagnostics: ['summary'],
      maxRuntimeSeconds: 30,
      maxOutputBytes: 1024,
      allowNonIdempotent: false,
      systemdUnits: [],
      dockerContainers: [],
      kubernetesNamespaces: [],
      bashCommandPatterns: [],
    },
    pin,
    'agent'
  );
  expect(result).toEqual([
    { key: 'diagnose', allowed: true },
    { key: 'write', allowed: false },
  ]);
});
it('rejects tampered and wrong-Agent policy envelopes before reading their actions', () => {
  const check = envelope();
  expect(() =>
    evaluatePolicyCheck(
      { ...check, id: 'tampered' },
      {
        allowedStepTypes: [],
        allowNonIdempotent: false,
        systemdUnits: [],
        dockerContainers: [],
        kubernetesNamespaces: [],
        bashCommandPatterns: [],
        maxRuntimeSeconds: 30,
        maxOutputBytes: 1024,
      },
      pin,
      'agent'
    )
  ).toThrow();
  expect(() =>
    evaluatePolicyCheck(
      check,
      {
        allowedStepTypes: [],
        allowNonIdempotent: false,
        systemdUnits: [],
        dockerContainers: [],
        kubernetesNamespaces: [],
        bashCommandPatterns: [],
        maxRuntimeSeconds: 30,
        maxOutputBytes: 1024,
      },
      pin,
      'other-agent'
    )
  ).toThrow();
});

it('reports redacted command fields as indeterminate, even if a placeholder matches an allowlist', () => {
  const { signature: _signature, ...body } = envelope();
  body.steps = [{ ...body.steps[1], config: { command: 'echo [REDACTED]' } }];
  const signed = {
    ...body,
    signature: sign(null, Buffer.from(canonicalEnvelope(body)), keys.privateKey).toString('base64'),
  };
  expect(
    evaluatePolicyCheck(
      signed,
      {
        allowedStepTypes: ['BASH'],
        allowNonIdempotent: true,
        systemdUnits: [],
        dockerContainers: [],
        kubernetesNamespaces: [],
        bashCommandPatterns: ['^echo .*'],
        maxRuntimeSeconds: 30,
        maxOutputBytes: 1024,
      },
      pin,
      'agent'
    )
  ).toEqual([{ key: 'write', allowed: null, reason: 'REDACTED_INPUT' }]);
});

it('certifies a static Bash command while secret environment metadata stays redacted', () => {
  const { signature: _signature, ...body } = envelope();
  const command = 'test -n "$OPSKNIGHT_INPUT_TOKEN"';
  body.steps = [{ ...body.steps[1], config: { command, env: { TOKEN: '[REDACTED]' } } }];
  const signed = {
    ...body,
    signature: sign(null, Buffer.from(canonicalEnvelope(body)), keys.privateKey).toString('base64'),
  };
  const policy = {
    allowedStepTypes: ['BASH' as const],
    allowNonIdempotent: true,
    systemdUnits: [],
    dockerContainers: [],
    kubernetesNamespaces: [],
    bashCommandPatterns: [command],
    maxRuntimeSeconds: 30,
    maxOutputBytes: 1024,
  };
  expect(evaluatePolicyCheck(signed, policy, pin, 'agent')).toEqual([
    { key: 'write', allowed: true },
  ]);
  expect(
    evaluatePolicyCheck(signed, { ...policy, bashCommandPatterns: ['echo safe'] }, pin, 'agent')
  ).toEqual([{ key: 'write', allowed: false }]);
});
