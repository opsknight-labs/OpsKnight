import { describe, expect, it } from 'vitest';
import { runbookInputsSchema } from '@/lib/runbooks/schemas';
import { normalizeConditionValue, validateConditionComparison } from '@/lib/runbooks/conditions';
import { validateAuthoringDefinition } from '@/lib/runbooks/authoring-validation';
import { parseInputDefault } from '@/lib/runbooks/input-values';
import {
  parseRunbookDefinition,
  referencedStepInputKeys,
  resolveInputTemplates,
} from '@/lib/runbooks/shared-definition';
import { buildExecutionPreview, checkExecutionReadiness } from '@/lib/runbooks/execution-preview';
import { runbookTroubleshooting } from '@/lib/runbooks/presentation/troubleshooting';
import { newBuilderStep } from '@/lib/runbooks/builder';

describe('runbook authoring and execution contract', () => {
  it('checks shared-pool capability and secret eligibility per action rather than across unrelated steps', async () => {
    let granted = true;
    const tx = {
      runbookAgent: {
        findMany: async () => [
          { id: 'linux', capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'] },
          { id: 'bash', capabilities: ['BASH'] },
        ],
      },
      runbookSecret: {
        findMany: async () =>
          granted ? [{ name: 'token', grants: [{ agentId: 'bash', agentPoolId: null }] }] : [],
      },
    } as unknown as import('@prisma/client').Prisma.TransactionClient;
    const plan = {
      agentId: null,
      agentPoolId: 'shared-pool',
      inputValues: { token: 'secret://token' },
      steps: [
        newBuilderStep('LINUX_DIAGNOSTICS', 'inspect'),
        {
          ...newBuilderStep('BASH', 'check'),
          config: { command: 'check "$OPSKNIGHT_INPUT_TOKEN"' },
        },
      ],
    };
    expect((await checkExecutionReadiness(tx, plan)).map(check => check.state)).toEqual([
      'passed',
      'passed',
      'deferred',
    ]);
    granted = false;
    expect((await checkExecutionReadiness(tx, plan)).map(check => check.state)).toEqual([
      'passed',
      'blocked',
      'deferred',
    ]);
  });
  it('does not require Agent secret grants for descriptive metadata alone', async () => {
    let secretQueries = 0;
    const tx = {
      runbookAgent: {
        findMany: async () => [{ id: 'linux', capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'] }],
      },
      runbookSecret: {
        findMany: async () => {
          secretQueries++;
          return [];
        },
      },
    } as unknown as import('@prisma/client').Prisma.TransactionClient;
    const step = {
      ...newBuilderStep('LINUX_DIAGNOSTICS', 'inspect'),
      name: 'Inspect ${{ inputs.token }}',
      description: 'Reference ${{ inputs.token }}',
      config: { action: 'uptime' },
    };
    const plan = {
      agentId: 'linux',
      agentPoolId: null,
      inputValues: { token: 'secret://token' },
      steps: [step],
    };
    expect((await checkExecutionReadiness(tx, plan)).map(check => check.state)).toEqual([
      'passed',
      'deferred',
    ]);
    expect(secretQueries).toBe(0);
    const executableStep = {
      ...step,
      config: { action: 'uptime', annotation: '${{ inputs.token }}' },
    };
    plan.steps = [executableStep];
    expect((await checkExecutionReadiness(tx, plan)).map(check => check.state)).toEqual([
      'passed',
      'blocked',
      'deferred',
    ]);
    expect(secretQueries).toBe(1);
  });

  it.each([
    ['NUMBER', 'abc'],
    ['NUMBER', 'Infinity'],
    ['BOOLEAN', 'yes'],
    ['URL', 'file:///tmp/data'],
    ['URL', 'https://user:password@example.com'],
    ['DURATION', 'soon'],
    ['SECRET_REF', 'secret://'],
  ] as const)('rejects invalid %s defaults before saving', (type, defaultValue) => {
    expect(
      runbookInputsSchema.safeParse([{ key: 'target', label: 'Target', type, defaultValue }])
        .success
    ).toBe(false);
  });
  it('preserves zero, false and optional emptiness without resolving secrets', () => {
    expect(parseInputDefault({ key: 'count', type: 'NUMBER', defaultValue: '0' })).toBe(0);
    expect(parseInputDefault({ key: 'enabled', type: 'BOOLEAN', defaultValue: 'false' })).toBe(
      false
    );
    expect(parseInputDefault({ key: 'optional', type: 'NUMBER', defaultValue: '' })).toBe('');
    expect(
      parseInputDefault({
        key: 'credential',
        type: 'SECRET_REF',
        defaultValue: 'secret://not-yet-installed',
      })
    ).toBe('secret://not-yet-installed');
  });
  it('normalizes every list member and clears unary comparisons', () => {
    expect(
      normalizeConditionValue({
        previousValue: [0, 2],
        previousType: 'NUMBER',
        nextType: 'STRING',
        operator: 'IN',
      })
    ).toEqual(['0', '2']);
    expect(
      normalizeConditionValue({
        previousValue: ['true', 'false'],
        previousType: 'STRING',
        nextType: 'BOOLEAN',
        operator: 'IN',
      })
    ).toEqual([true, false]);
    expect(
      normalizeConditionValue({
        previousValue: ['3', 'invalid'],
        previousType: 'STRING',
        nextType: 'NUMBER',
        operator: 'IN',
      })
    ).toBeUndefined();
    expect(
      normalizeConditionValue({
        previousValue: 2,
        previousType: 'NUMBER',
        nextType: 'STRING',
        operator: 'EXISTS',
      })
    ).toBeUndefined();
    expect(validateConditionComparison({ operator: 'CONTAINS', value: 3 }, 'NUMBER')).toBeTruthy();
  });
  it('extracts templates in every runtime-resolved config value without interpreting ordinary text', () => {
    const step = {
      ...newBuilderStep('BASH', 'inspect'),
      config: {
        command: 'printenv OPSKNIGHT_INPUT_TARGET',
        extra: ['${{ inputs.flag }}', 'input.owner'],
      },
    };
    expect([...referencedStepInputKeys(step)].sort()).toEqual(['flag', 'target']);
    expect(resolveInputTemplates(step.config, { flag: false })).toEqual({
      command: 'printenv OPSKNIGHT_INPUT_TARGET',
      extra: [false, 'input.owner'],
    });
  });
  it('returns structured nested errors and agrees with the server parser', () => {
    const step = newBuilderStep('MANUAL', 'task');
    step.verification = {
      steps: [
        {
          ...newBuilderStep('SYSTEMD', 'check'),
          config: { unit: '${{ inputs.missing }}', action: 'status' },
        },
      ],
    };
    const issues = validateAuthoringDefinition({ steps: [step] }, []);
    expect(issues[0]).toMatchObject({
      code: 'INPUT_REFERENCE_UNDECLARED',
      stepKey: 'check',
      path: ['definition', 'steps', 0, 'verification', 'steps', 0],
    });
    expect(() => parseRunbookDefinition({ steps: [step] }, [])).toThrow('undeclared');
  });
  it('binds preview digests to resolved inputs, target, approval and immutable version while redacting credentials', () => {
    const plan = {
      runbookId: 'book',
      versionId: 'version',
      version: 1,
      checksum: 'checksum',
      agentId: 'agent',
      agentPoolId: null,
      selectedLabels: {},
      timeoutSeconds: 3600,
      inputValues: { credential: 'secret://api-token', count: 0 },
      inputTypes: [{ key: 'credential', type: 'SECRET_REF' }],
      steps: [
        {
          ...newBuilderStep('HTTP', 'call'),
          riskClass: 'NON_IDEMPOTENT' as const,
          config: {
            method: 'POST',
            url: 'https://api.example.com',
            headers: { Authorization: '${{ inputs.credential }}' },
          },
        },
      ],
    };
    const preview = buildExecutionPreview(plan);
    expect(preview.inputs).toEqual({ credential: '[REDACTED]', count: 0 });
    expect(JSON.stringify(preview)).not.toContain('secret://api-token');
    expect(preview.steps[0].requiresApproval).toBe(true);
    expect(preview.digest).not.toBe(buildExecutionPreview({ ...plan, agentId: 'other' }).digest);
    expect(preview.digest).not.toBe(
      buildExecutionPreview({ ...plan, inputValues: { ...plan.inputValues, count: 1 } }).digest
    );
    expect(preview.digest).not.toBe(buildExecutionPreview({ ...plan, versionId: 'next' }).digest);
  });
});

describe('bounded authoring and troubleshooting', () => {
  it('rejects configuration depth that cannot be resolved at dispatch', () => {
    const nested = Array.from({ length: 13 }).reduce<unknown>(value => ({ nested: value }), 'leaf');
    const step = { ...newBuilderStep('MANUAL', 'deep'), config: nested as Record<string, unknown> };
    expect(validateAuthoringDefinition({ steps: [step] }, [])[0]).toMatchObject({
      code: 'DEFINITION_DEPTH_EXCEEDED',
      stepKey: 'deep',
    });
    expect(() => resolveInputTemplates(step.config, {})).toThrow('nested too deeply');
  });
  it('always treats uncertain cancellation/timeouts as an inspection requirement', () => {
    expect(runbookTroubleshooting('FAILED', 'CANCEL_ACK_TIMEOUT_UNKNOWN')).toMatchObject({
      category: 'uncertain',
    });
    expect(runbookTroubleshooting('TIMED_OUT', 'TIMED_OUT_WITH_UNKNOWN_OUTCOME')?.action).toContain(
      'Inspect the actual target'
    );
    expect(runbookTroubleshooting('FAILED', 'MISSING_SECRET_GRANT')).toMatchObject({
      category: 'policy',
    });
    expect(runbookTroubleshooting('SUCCEEDED')).toBeUndefined();
  });

  it('validates a supported 50-step / 30-input workflow and rejects over-limit definitions', () => {
    const inputs = Array.from({ length: 30 }, (_, index) => ({
      key: `param_${index}`,
      label: `Parameter ${index}`,
      type: 'STRING',
    }));
    const definition = {
      steps: Array.from({ length: 50 }, (_, index) => ({
        ...newBuilderStep('HTTP', `step_${index}`),
        config: { method: 'POST', url: 'https://api.example.com', body: 'x'.repeat(4700) },
        riskClass: 'NON_IDEMPOTENT',
      })),
    };
    const started = performance.now();
    expect(validateAuthoringDefinition(definition, inputs)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(
      validateAuthoringDefinition(
        { steps: [...definition.steps, newBuilderStep('WAIT', 'overflow')] },
        inputs
      )
    ).not.toEqual([]);
    expect(
      validateAuthoringDefinition(definition, [
        ...inputs,
        { key: 'overflow', label: 'Extra', type: 'STRING' },
      ])
    ).not.toEqual([]);
    expect(
      validateAuthoringDefinition(
        {
          ...definition,
          description: 'x'.repeat(5000),
          steps: definition.steps.map(step => ({
            ...step,
            config: { ...step.config, body: 'x'.repeat(5200) },
          })),
        },
        inputs
      )
    ).not.toEqual([]);
  });

  it('rejects contradictory Systemd configurations in definition parsing', () => {
    expect(() =>
      parseRunbookDefinition({
        steps: [
          {
            key: 'sys_check',
            name: 'Check',
            type: 'SYSTEMD',
            riskClass: 'READ_ONLY',
            config: {
              action: 'status',
              unit: 'cert-sample.service',
              expectedState: 'inactive',
              requireActive: true,
            },
          },
        ],
      })
    ).toThrow(/contradictory configuration/);

    expect(() =>
      parseRunbookDefinition({
        steps: [
          {
            key: 'sys_check',
            name: 'Check',
            type: 'SYSTEMD',
            riskClass: 'READ_ONLY',
            config: {
              action: 'status',
              unit: 'cert-sample.service',
              expectedState: 'active',
              requireActive: false,
            },
          },
        ],
      })
    ).toThrow(/contradictory configuration/);
  });
});
