import { describe, expect, it } from 'vitest';
import {
  computeUnattendedWriteScope,
  type UnattendedScopeRule,
  type UnattendedScopeTrigger,
} from '@/lib/runbooks/unattended-scope';

const rule: UnattendedScopeRule = {
  mode: 'AUTOMATIC',
  versionStrategy: 'PINNED',
  runbookVersionId: 'v1',
  defaultAgentId: null,
  defaultAgentPoolId: 'pool',
  agentSelector: { zone: 'eu', role: 'db' },
  inputValues: { cluster: 'a', replicas: 2 },
  contextInputMappings: [{ inputKey: 'cluster', contextKey: 'cluster' }],
  contextTargetMappings: { contextKey: null, entries: [] },
  runOnMonitoringIncidents: false,
  resolveOnVerifiedRecovery: false,
};

const trigger: UnattendedScopeTrigger = {
  event: 'INCIDENT_CREATED',
  conditionLogic: 'AND',
  enabled: true,
  conditions: [
    { field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH', sequence: 0 },
    { field: 'automation.cluster', operator: 'EQUALS', value: 'eu-1', sequence: 1 },
  ],
};

describe('computeUnattendedWriteScope', () => {
  const base = computeUnattendedWriteScope(rule, [trigger]);

  it('is stable across key and condition ordering', () => {
    expect(
      computeUnattendedWriteScope(
        {
          ...rule,
          agentSelector: { role: 'db', zone: 'eu' },
          inputValues: { replicas: 2, cluster: 'a' },
        },
        [{ ...trigger, conditions: [...trigger.conditions].reverse() }]
      )
    ).toBe(base);
  });

  it.each<[string, Partial<UnattendedScopeRule>]>([
    ['version', { runbookVersionId: 'v2' }],
    ['agent pool', { defaultAgentPoolId: 'other' }],
    ['agent', { defaultAgentId: 'agent' }],
    ['selector', { agentSelector: { zone: 'us', role: 'db' } }],
    ['inputs', { inputValues: { cluster: 'b', replicas: 2 } }],
    ['input mappings', { contextInputMappings: [] }],
    [
      'target mappings',
      { contextTargetMappings: { contextKey: 'cluster', entries: [{ value: 'x', agentId: 'a' }] } },
    ],
    ['monitoring opt-in', { runOnMonitoringIncidents: true }],
    ['automatic incident resolution', { resolveOnVerifiedRecovery: true }],
  ])('changes when the %s changes', (_name, change) => {
    expect(computeUnattendedWriteScope({ ...rule, ...change }, [trigger])).not.toBe(base);
  });

  it('changes when trigger conditions or logic change', () => {
    expect(
      computeUnattendedWriteScope(rule, [
        { ...trigger, conditions: trigger.conditions.slice(0, 1) },
      ])
    ).not.toBe(base);
    expect(computeUnattendedWriteScope(rule, [{ ...trigger, conditionLogic: 'OR' }])).not.toBe(
      base
    );
    expect(computeUnattendedWriteScope(rule, [])).not.toBe(base);
  });

  it('ignores disabled triggers, which cannot fire', () => {
    expect(
      computeUnattendedWriteScope(rule, [trigger, { ...trigger, event: 'OTHER', enabled: false }])
    ).toBe(base);
  });
});
