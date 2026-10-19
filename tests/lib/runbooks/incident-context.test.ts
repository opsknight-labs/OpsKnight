import { describe, expect, it, vi } from 'vitest';
import {
  buildResponseContext,
  type IncidentResponseContext,
} from '@/lib/automation/response-context';
import {
  automationContextFields,
  conditionsReferenceAutomation,
  loadRunbookIncidentContext,
  type RunbookTriggerContext,
} from '@/lib/runbooks/incident-context';
import {
  conditionValueType,
  triggerConditionFieldSchema,
  workflowConditionSchema,
} from '@/lib/runbooks/conditions';
import { evaluateTrigger, validateAndMatchTrigger } from '@/lib/runbooks/matcher';
import { createRunbookTriggerSchema } from '@/lib/runbooks/schemas';
import { AUTOMATION_CONDITION_FIELD } from '@/lib/runbooks/automation-binding';

function context(): IncidentResponseContext {
  return buildResponseContext({
    versionId: 'version-1',
    versionNumber: 3,
    fields: [
      { fieldId: 'env', key: 'environment', type: 'ENUM' },
      { fieldId: 'cluster', key: 'cluster', type: 'STRING' },
      { fieldId: 'replicas', key: 'replicas', type: 'NUMBER' },
      { fieldId: 'canary', key: 'canary', type: 'BOOLEAN' },
      { fieldId: 'region', key: 'region', type: 'STRING' },
      { fieldId: 'zone', key: 'zone', type: 'STRING' },
    ],
    inputContext: {},
    enrichedContext: {
      environment: { state: 'RECOGNIZED', value: 'production' },
      cluster: { state: 'RECOGNIZED', value: 'eu-1' },
      replicas: { state: 'RECOGNIZED', value: 3 },
      canary: { state: 'RECOGNIZED', value: false },
      region: { state: 'UNMAPPED', raw: 'mars' },
      zone: { state: 'MISSING' },
    },
  });
}

function triggerContext(available: boolean): RunbookTriggerContext {
  return {
    incident: {
      id: 'inc',
      title: 'Disk full',
      description: null,
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      tags: ['db'],
    },
    service: { id: 'svc', name: 'API', teamId: null },
    automation: {
      available,
      reason: available ? null : 'NO_LIVE_DECISION',
      versionNumber: available ? 3 : null,
      fields: available ? automationContextFields(context()) : null,
    },
  };
}

describe('runbook incident context helpers', () => {
  it('accepts only lowercase automation field keys (no arbitrary JSON paths)', () => {
    expect(AUTOMATION_CONDITION_FIELD.test('automation.cluster')).toBe(true);
    expect(AUTOMATION_CONDITION_FIELD.test('automation.k8s_cluster_2')).toBe(true);
    for (const field of [
      'automation.',
      'automation.Cluster',
      'automation.a.b',
      'automation.1x',
      'context.cluster',
      `automation.a${'b'.repeat(64)}`,
    ])
      expect(AUTOMATION_CONDITION_FIELD.test(field)).toBe(false);
    expect(conditionsReferenceAutomation([{ field: 'incident.priority' }])).toBe(false);
    expect(
      conditionsReferenceAutomation([{ field: 'incident.priority' }, { field: 'automation.env' }])
    ).toBe(true);
  });

  it('never exposes raw content of MISSING or UNMAPPED fields', () => {
    const fields = automationContextFields(context())!;
    expect(fields.find(field => field.key === 'region')).toEqual({
      key: 'region',
      type: 'STRING',
      state: 'UNMAPPED',
      value: null,
    });
    expect(fields.find(field => field.key === 'zone')?.state).toBe('MISSING');
    expect(automationContextFields(null)).toBeNull();
  });

  it('loads trigger context from the verified decision and reports why it is unavailable', async () => {
    const incident = {
      id: 'inc',
      title: 'Disk full',
      description: null,
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      tags: [{ tag: { name: 'db' } }],
      service: { id: 'svc', name: 'API', teamId: null },
    };
    const client = (decision: unknown) =>
      ({
        incident: { findUnique: vi.fn().mockResolvedValue(incident) },
        incidentAutomationDecision: { findUnique: vi.fn().mockResolvedValue(decision) },
      }) as unknown as Parameters<typeof loadRunbookIncidentContext>[0];
    const verified = context();
    const available = await loadRunbookIncidentContext(
      client({ mode: 'LIVE', fallbackReason: null, responseContext: verified }),
      'inc'
    );
    expect(available?.responseContext).toEqual(verified);
    expect(available?.trigger.automation).toMatchObject({
      available: true,
      reason: null,
      versionNumber: 3,
    });
    expect(available?.trigger.automation.fields).toHaveLength(6);
    const tampered = await loadRunbookIncidentContext(
      client({
        mode: 'LIVE',
        fallbackReason: null,
        responseContext: {
          ...verified,
          fields: verified.fields.map(field =>
            field.key === 'cluster' ? { ...field, value: 'us-1' } : field
          ),
        },
      }),
      'inc'
    );
    expect(tampered?.responseContext).toBeNull();
    expect(tampered?.trigger.automation).toEqual({
      available: false,
      reason: 'INTEGRITY_FAILED',
      versionNumber: null,
      fields: null,
    });
    for (const [decision, reason] of [
      [null, 'NO_LIVE_DECISION'],
      [{ mode: 'SHADOW', fallbackReason: null, responseContext: verified }, 'NO_LIVE_DECISION'],
      [{ mode: 'LIVE', fallbackReason: 'VERSION_INVALID', responseContext: verified }, 'FALLBACK'],
      [{ mode: 'LIVE', fallbackReason: null, responseContext: null }, 'NOT_CAPTURED'],
    ] as const) {
      const loaded = await loadRunbookIncidentContext(client(decision), 'inc');
      expect(loaded?.trigger.automation.reason).toBe(reason);
      expect(loaded?.trigger.automation.fields).toBeNull();
    }
  });
});

describe('automation trigger conditions', () => {
  it('accepts automation fields for triggers but not for workflow CONDITION steps', () => {
    expect(triggerConditionFieldSchema.safeParse('automation.cluster').success).toBe(true);
    expect(triggerConditionFieldSchema.safeParse('incident.priority').success).toBe(true);
    expect(triggerConditionFieldSchema.safeParse('context.cluster').success).toBe(false);
    expect(triggerConditionFieldSchema.safeParse('automation.a.b').success).toBe(false);
    expect(workflowConditionSchema.safeParse({ field: 'automation.cluster' }).success).toBe(false);
    expect(
      workflowConditionSchema.safeParse({ field: 'incident.priority', operator: 'IS_MISSING' })
        .success
    ).toBe(false);
    expect(
      createRunbookTriggerSchema.safeParse({
        event: 'INCIDENT_CREATED',
        conditions: [{ field: 'automation.__proto__', operator: 'EXISTS' }],
      }).success
    ).toBe(false);
  });

  it('types comparison values from the automation field declaration', () => {
    const fields = [
      { key: 'replicas', type: 'NUMBER' },
      { key: 'canary', type: 'BOOLEAN' },
    ];
    expect(conditionValueType('automation.replicas', [], fields)).toBe('NUMBER');
    expect(conditionValueType('automation.canary', [], fields)).toBe('BOOLEAN');
    expect(conditionValueType('automation.unknown', [], fields)).toBe('STRING');
  });

  const live = triggerContext(true);
  const match = (
    conditions: Parameters<typeof validateAndMatchTrigger>[1],
    logic: 'AND' | 'OR' = 'AND',
    ctx = live
  ) => validateAndMatchTrigger(ctx, conditions, logic);

  it('matches all four field types with strict typing', () => {
    expect(
      match([{ field: 'automation.environment', operator: 'EQUALS', value: 'production' }])
    ).toBe(true);
    expect(match([{ field: 'automation.environment', operator: 'IN', value: ['staging'] }])).toBe(
      false
    );
    expect(match([{ field: 'automation.cluster', operator: 'STARTS_WITH', value: 'eu-' }])).toBe(
      true
    );
    expect(match([{ field: 'automation.cluster', operator: 'NOT_EQUALS', value: 'us-1' }])).toBe(
      true
    );
    expect(match([{ field: 'automation.replicas', operator: 'IN', value: [3, 4] }])).toBe(true);
    expect(match([{ field: 'automation.replicas', operator: 'NOT_IN', value: [5] }])).toBe(true);
    expect(match([{ field: 'automation.canary', operator: 'EQUALS', value: false }])).toBe(true);
    expect(match([{ field: 'automation.canary', operator: 'NOT_EQUALS', value: false }])).toBe(
      false
    );
  });

  it('treats a mistyped value as configuration-invalid instead of coercing', () => {
    expect(
      evaluateTrigger(
        live,
        [{ field: 'automation.replicas', operator: 'EQUALS', value: '3' }],
        'AND'
      )
    ).toMatchObject({ status: 'CONFIG_INVALID', reason: expect.stringContaining('TYPE_CHANGED') });
    expect(
      evaluateTrigger(
        live,
        [{ field: 'automation.canary', operator: 'EQUALS', value: 'false' }],
        'AND'
      ).status
    ).toBe('CONFIG_INVALID');
  });

  it('never matches MISSING/UNMAPPED with positive or negative comparisons', () => {
    for (const key of ['zone', 'region'])
      for (const [operator, value] of [
        ['EQUALS', 'x'],
        ['NOT_EQUALS', 'x'],
        ['IN', ['x']],
        ['NOT_IN', ['x']],
        ['CONTAINS', 'x'],
        ['EXISTS', null],
      ] as const)
        expect(match([{ field: `automation.${key}`, operator, value }])).toBe(false);
  });

  it('supports explicit IS_MISSING / IS_UNMAPPED', () => {
    expect(match([{ field: 'automation.zone', operator: 'IS_MISSING', value: null }])).toBe(true);
    expect(match([{ field: 'automation.zone', operator: 'IS_UNMAPPED', value: null }])).toBe(false);
    expect(match([{ field: 'automation.region', operator: 'IS_UNMAPPED', value: null }])).toBe(
      true
    );
    expect(match([{ field: 'automation.cluster', operator: 'IS_MISSING', value: null }])).toBe(
      false
    );
    expect(() =>
      match([{ field: 'incident.priority', operator: 'IS_MISSING', value: null }])
    ).toThrow('unsupported condition');
  });

  it('records match reasons that combine standard and automation conditions', () => {
    const evaluation = evaluateTrigger(
      live,
      [
        { field: 'automation.environment', operator: 'EQUALS', value: 'production' },
        { field: 'incident.priority', operator: 'IN', value: ['P1', 'P2'] },
        { field: 'incident.tags', operator: 'CONTAINS', value: 'db' },
      ],
      'AND'
    );
    expect(evaluation).toEqual({
      status: 'MATCHED',
      reason: expect.stringContaining('automation.environment EQUALS "production"'),
    });
  });

  it('never fires automation rules without verified context (SHADOW/fallback/OFF), even with OR', () => {
    const off = triggerContext(false);
    expect(
      evaluateTrigger(
        off,
        [{ field: 'automation.zone', operator: 'IS_MISSING', value: null }],
        'AND'
      )
    ).toEqual({
      status: 'CONTEXT_UNAVAILABLE',
      reason: expect.stringContaining('NO_LIVE_DECISION'),
    });
    expect(
      match(
        [
          { field: 'incident.priority', operator: 'EQUALS', value: 'P1' },
          { field: 'automation.cluster', operator: 'EXISTS', value: null },
        ],
        'OR',
        off
      )
    ).toBe(false);
    expect(
      match([{ field: 'incident.priority', operator: 'EQUALS', value: 'P1' }], 'AND', off)
    ).toBe(true);
  });

  it('makes rules referencing a removed field configuration-invalid, even under OR', () => {
    const evaluation = evaluateTrigger(
      live,
      [
        { field: 'incident.priority', operator: 'EQUALS', value: 'P1' },
        { field: 'automation.removed_field', operator: 'EQUALS', value: 'x' },
      ],
      'OR'
    );
    expect(evaluation).toEqual({
      status: 'CONFIG_INVALID',
      reason: expect.stringContaining('AUTOMATION_FIELD_REMOVED'),
    });
  });
});
