import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@/lib/authorization';
import { RunbookDefinitionError } from '@/lib/runbooks/errors';

const mocks = vi.hoisted(() => ({
  assertCanModifyService: vi.fn(),
  assertCapability: vi.fn(),
  authorizeUnattendedWrites: vi.fn(),
  revokeUnattendedWrites: vi.fn(),
  replaceBindingTrigger: vi.fn(),
  updateServiceBinding: vi.fn(),
  createServiceBinding: vi.fn(),
  detachServiceBinding: vi.fn(),
  bindingFindFirst: vi.fn(),
  versionFindFirst: vi.fn(),
  contextFields: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertCanModifyService: mocks.assertCanModifyService,
  assertCapability: mocks.assertCapability,
}));
vi.mock('@/lib/runbooks/bindings', () => ({
  authorizeUnattendedWrites: mocks.authorizeUnattendedWrites,
  revokeUnattendedWrites: mocks.revokeUnattendedWrites,
  replaceBindingTrigger: mocks.replaceBindingTrigger,
  updateServiceBinding: mocks.updateServiceBinding,
  createServiceBinding: mocks.createServiceBinding,
  detachServiceBinding: mocks.detachServiceBinding,
}));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    serviceRunbookBinding: { findFirst: mocks.bindingFindFirst },
    runbookVersion: { findFirst: mocks.versionFindFirst },
  },
}));
vi.mock('@/lib/automation/context-fields', () => ({
  getServiceAutomationContextFields: mocks.contextFields,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import {
  authorizeUnattendedWritesAction,
  configureRunbookTriggerAction,
  revokeUnattendedWritesAction,
  updateRunbookBindingAction,
} from '@/app/(app)/services/[id]/runbook-actions';

const SERVICE = 'cjld2cjxh0000qzrmn831i7rn';
const BINDING = 'cjld2cyuq0000t3rmniod1foy';
const VERSION = 'cjld2d5m30000u8rm7f8b8v1r';
const RUNBOOK = 'cjld2dbyb0000v3rmgdnu1f1x';

function denyCapability(denied: string) {
  mocks.assertCapability.mockImplementation(async (capability: string) => {
    if (capability === denied) throw new AuthorizationError('Denied', capability as never);
    return { id: 'user-1', role: 'RESPONDER' };
  });
}

function triggerForm(
  conditions: Array<[string, string, string]>,
  extra: Record<string, string> = {}
) {
  const form = new FormData();
  form.set('event', 'INCIDENT_CREATED');
  form.set('conditionLogic', 'AND');
  for (const [field, operator, value] of conditions) {
    form.append('conditionField', field);
    form.append('conditionOperator', operator);
    form.append('conditionValue', value);
  }
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCanModifyService.mockResolvedValue({ id: 'user-1', role: 'ADMIN' });
  mocks.assertCapability.mockResolvedValue({ id: 'user-1', role: 'ADMIN' });
  mocks.contextFields.mockResolvedValue({
    mode: 'LIVE',
    versionNumber: 2,
    fields: [
      {
        key: 'priority',
        label: 'Priority',
        type: 'ENUM',
        caseSensitive: true,
        allowedValues: ['P1', 'P2'],
      },
      { key: 'environment', label: 'Environment', type: 'STRING', caseSensitive: false },
      { key: 'replicas', label: 'Replicas', type: 'NUMBER', caseSensitive: false },
      { key: 'canary', label: 'Canary', type: 'BOOLEAN', caseSensitive: false },
    ],
  });
});

describe('unattended write authorization actions', () => {
  it('requires the admin automation.publish capability before authorizing', async () => {
    denyCapability('automation.publish');
    await expect(authorizeUnattendedWritesAction(SERVICE, BINDING, VERSION)).rejects.toThrow(
      AuthorizationError
    );
    expect(mocks.assertCapability).toHaveBeenCalledWith(
      'automation.publish',
      expect.stringContaining('Only administrators')
    );
    expect(mocks.authorizeUnattendedWrites).not.toHaveBeenCalled();
  });

  it('rejects revocation by non-administrators', async () => {
    denyCapability('automation.publish');
    await expect(revokeUnattendedWritesAction(SERVICE, BINDING)).rejects.toThrow(
      AuthorizationError
    );
    expect(mocks.revokeUnattendedWrites).not.toHaveBeenCalled();
  });

  it('rejects malformed identifiers before any authorization or mutation', async () => {
    await expect(
      authorizeUnattendedWritesAction(SERVICE, BINDING, 'not-a-version')
    ).rejects.toThrow();
    await expect(revokeUnattendedWritesAction('bad id', BINDING)).rejects.toThrow();
    expect(mocks.assertCanModifyService).not.toHaveBeenCalled();
    expect(mocks.authorizeUnattendedWrites).not.toHaveBeenCalled();
    expect(mocks.revokeUnattendedWrites).not.toHaveBeenCalled();
  });

  it('authorizes the exact pinned version and revalidates the service', async () => {
    await expect(
      authorizeUnattendedWritesAction(SERVICE, BINDING, VERSION)
    ).resolves.toBeUndefined();
    expect(mocks.assertCanModifyService).toHaveBeenCalledWith(SERVICE);
    expect(mocks.authorizeUnattendedWrites).toHaveBeenCalledWith(
      SERVICE,
      BINDING,
      { expectedVersionId: VERSION },
      'user-1'
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/services/${SERVICE}`);
  });

  it('returns domain refusals to the form instead of throwing', async () => {
    mocks.authorizeUnattendedWrites.mockRejectedValue(
      new RunbookDefinitionError('UNATTENDED_WRITE_VERIFICATION_REQUIRED: Add verification.')
    );
    await expect(authorizeUnattendedWritesAction(SERVICE, BINDING, VERSION)).resolves.toEqual({
      error: 'UNATTENDED_WRITE_VERIFICATION_REQUIRED: Add verification.',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('revokes with the acting administrator', async () => {
    await revokeUnattendedWritesAction(SERVICE, BINDING);
    expect(mocks.revokeUnattendedWrites).toHaveBeenCalledWith(SERVICE, BINDING, 'user-1');
  });
});

describe('configureRunbookTriggerAction with automation context', () => {
  it('coerces context values to the stored automation types', async () => {
    await configureRunbookTriggerAction(
      SERVICE,
      BINDING,
      triggerForm([
        ['automation.priority', 'IN', 'P1, P2'],
        ['automation.environment', 'EQUALS', ' Production '],
        ['automation.replicas', 'EQUALS', '3'],
        ['automation.canary', 'EQUALS', 'false'],
        ['automation.environment', 'IS_MISSING', ''],
        ['incident.urgency', 'EQUALS', 'HIGH'],
        ['none', 'EQUALS', ''],
      ])
    );
    expect(mocks.replaceBindingTrigger).toHaveBeenCalledWith(
      SERVICE,
      BINDING,
      {
        event: 'INCIDENT_CREATED',
        conditionLogic: 'AND',
        enabled: true,
        conditions: [
          { field: 'automation.priority', operator: 'IN', value: ['P1', 'P2'], sequence: 0 },
          { field: 'automation.environment', operator: 'EQUALS', value: 'production', sequence: 1 },
          { field: 'automation.replicas', operator: 'EQUALS', value: 3, sequence: 2 },
          { field: 'automation.canary', operator: 'EQUALS', value: false, sequence: 3 },
          { field: 'automation.environment', operator: 'IS_MISSING', value: null, sequence: 4 },
          { field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH', sequence: 5 },
        ],
      },
      'user-1'
    );
  });

  it('does not load automation context for incident-only triggers', async () => {
    await configureRunbookTriggerAction(
      SERVICE,
      BINDING,
      triggerForm([['incident.urgency', 'EXISTS', '']])
    );
    expect(mocks.contextFields).not.toHaveBeenCalled();
    expect(mocks.replaceBindingTrigger).toHaveBeenCalled();
  });

  it.each([
    [['automation.region', 'EQUALS', 'eu'], /automation.region is not published/],
    [['automation.priority', 'EQUALS', 'P9'], /not an allowed value/],
    [['automation.priority', 'IN', 'P1, p2'], /"p2" is not an allowed value/],
    [['automation.replicas', 'EQUALS', 'many'], /expects a number/],
    [['automation.replicas', 'CONTAINS', '1'], /not supported/],
    [['automation.replicas', 'NOT_EXISTS', ''], /not supported/],
    [['incident.urgency', 'IS_UNMAPPED', ''], /only available for automation fields/],
  ] as Array<[[string, string, string], RegExp]>)(
    'rejects invalid automation condition %j',
    async (condition, message) => {
      const result = await configureRunbookTriggerAction(
        SERVICE,
        BINDING,
        triggerForm([condition])
      );
      expect(result?.error).toMatch(message);
      expect(mocks.replaceBindingTrigger).not.toHaveBeenCalled();
    }
  );

  it('rejects malformed trigger forms with a Zod message', async () => {
    const result = await configureRunbookTriggerAction(
      SERVICE,
      BINDING,
      triggerForm([['incident.urgency', 'EQUALS', 'HIGH']], { conditionLogic: 'XOR' })
    );
    expect(result?.error).toMatch(/conditionLogic/);
    const unknownOperator = await configureRunbookTriggerAction(
      SERVICE,
      BINDING,
      triggerForm([['incident.urgency', 'MATCHES', 'HIGH']])
    );
    expect(unknownOperator?.error).toBeDefined();
    expect(mocks.replaceBindingTrigger).not.toHaveBeenCalled();
  });

  it('requires binding management rights', async () => {
    mocks.assertCanModifyService.mockRejectedValue(new Error('Forbidden service'));
    await expect(configureRunbookTriggerAction(SERVICE, BINDING, triggerForm([]))).rejects.toThrow(
      'Forbidden service'
    );
    expect(mocks.replaceBindingTrigger).not.toHaveBeenCalled();
  });
});

describe('updateRunbookBindingAction', () => {
  function bindingForm(overrides: Record<string, string> = {}) {
    const form = new FormData();
    form.set('mode', 'AUTOMATIC');
    form.set('versionStrategy', 'PINNED');
    form.set('runbookVersionId', VERSION);
    form.set('enabled', 'true');
    form.set('executionTarget', `pool:${VERSION}`);
    form.set('agentSelector', '{"role":"db"}');
    form.set('resolveOnVerifiedRecovery', 'true');
    form.set('runOnMonitoringIncidents', 'true');
    form.set(
      'contextInputMappings',
      JSON.stringify([{ inputKey: 'cluster', contextKey: 'cluster' }])
    );
    form.set(
      'contextTargetMappings',
      JSON.stringify({
        contextKey: 'cluster',
        entries: [{ value: 'prod-k8s-01', agentPoolId: VERSION }],
      })
    );
    for (const [key, value] of Object.entries(overrides)) form.set(key, value);
    return form;
  }

  beforeEach(() => {
    mocks.bindingFindFirst.mockResolvedValue({ runbookId: RUNBOOK });
    mocks.versionFindFirst.mockResolvedValue({ inputs: [] });
  });

  it('passes monitoring opt-in and validated mappings to the domain update', async () => {
    await updateRunbookBindingAction(SERVICE, BINDING, bindingForm());
    expect(mocks.updateServiceBinding).toHaveBeenCalledWith(
      SERVICE,
      BINDING,
      expect.objectContaining({
        resolveOnVerifiedRecovery: true,
        runOnMonitoringIncidents: true,
        contextInputMappings: [{ inputKey: 'cluster', contextKey: 'cluster' }],
        contextTargetMappings: {
          contextKey: 'cluster',
          entries: [{ value: 'prod-k8s-01', agentPoolId: VERSION }],
        },
        agentSelector: { role: 'db' },
        defaultAgentPoolId: VERSION,
      }),
      'user-1'
    );
    const update = mocks.updateServiceBinding.mock.calls[0][2];
    expect(update).not.toHaveProperty('unattendedWritesVersionId');
  });

  it.each([
    [{ contextInputMappings: '{bad' }, /valid JSON/],
    [{ contextInputMappings: JSON.stringify([{ inputKey: 'x', contextKey: 'a.b' }]) }, /Invalid/],
    [
      {
        contextTargetMappings: JSON.stringify({
          contextKey: 'cluster',
          entries: [{ value: 'a', agentPoolId: VERSION, agentId: VERSION }],
        }),
      },
      /exactly one/,
    ],
    [{ runOnMonitoringIncidents: 'maybe' }, /Invalid/],
  ] as Array<[Record<string, string>, RegExp]>)(
    'rejects malformed automation fields %j with zod',
    async (overrides, message) => {
      const result = await updateRunbookBindingAction(SERVICE, BINDING, bindingForm(overrides));
      expect(result?.error).toMatch(message);
      expect(mocks.updateServiceBinding).not.toHaveBeenCalled();
    }
  );

  it('requires binding management rights before reading mappings', async () => {
    mocks.assertCanModifyService.mockRejectedValue(new Error('Forbidden service'));
    await expect(updateRunbookBindingAction(SERVICE, BINDING, bindingForm())).rejects.toThrow(
      'Forbidden service'
    );
    expect(mocks.updateServiceBinding).not.toHaveBeenCalled();
  });

  it('returns validation errors for malformed selectors and toggle values', async () => {
    expect(
      await updateRunbookBindingAction(SERVICE, BINDING, bindingForm({ agentSelector: '[1]' }))
    ).toEqual({ error: expect.stringContaining('JSON object') });
    expect(
      await updateRunbookBindingAction(
        SERVICE,
        BINDING,
        bindingForm({ resolveOnVerifiedRecovery: 'yes' })
      )
    ).toEqual({ error: expect.any(String) });
    expect(mocks.updateServiceBinding).not.toHaveBeenCalled();
  });
});
