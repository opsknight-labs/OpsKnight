import { createHash } from 'crypto';

export type UnattendedScopeRule = {
  mode: string;
  versionStrategy: string;
  runbookVersionId: string | null;
  defaultAgentId: string | null;
  defaultAgentPoolId: string | null;
  agentSelector: unknown;
  inputValues: unknown;
  contextInputMappings: unknown;
  contextTargetMappings: unknown;
  runOnMonitoringIncidents: boolean;
  resolveOnVerifiedRecovery: boolean;
};

export type UnattendedScopeTrigger = {
  event: string;
  conditionLogic: string;
  enabled: boolean;
  conditions: ReadonlyArray<{
    field: string;
    operator: string;
    value: unknown;
    sequence: number;
  }>;
};

function canonical(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}

/**
 * Digest of everything that decides what an unattended rule runs, where and when. An
 * authorization is valid only while the rule still hashes to the value that was approved.
 */
export function computeUnattendedWriteScope(
  rule: UnattendedScopeRule,
  triggers: ReadonlyArray<UnattendedScopeTrigger>
): string {
  const scope = canonical({
    mode: rule.mode,
    versionStrategy: rule.versionStrategy,
    runbookVersionId: rule.runbookVersionId,
    defaultAgentId: rule.defaultAgentId,
    defaultAgentPoolId: rule.defaultAgentPoolId,
    agentSelector: rule.agentSelector,
    inputValues: rule.inputValues,
    contextInputMappings: rule.contextInputMappings,
    contextTargetMappings: rule.contextTargetMappings,
    runOnMonitoringIncidents: rule.runOnMonitoringIncidents,
    // Auto-resolving an incident after unattended writes needs the same administrator approval.
    resolveOnVerifiedRecovery: rule.resolveOnVerifiedRecovery,
    // A disabled trigger cannot fire, so only enabled triggers are part of the scope.
    triggers: triggers
      .filter(trigger => trigger.enabled)
      .map(trigger => ({
        event: trigger.event,
        conditionLogic: trigger.conditionLogic,
        conditions: [...trigger.conditions]
          .sort((a, b) => a.sequence - b.sequence)
          .map(({ field, operator, value }) => ({ field, operator, value })),
      }))
      .sort((a, b) => (a.event < b.event ? -1 : a.event > b.event ? 1 : 0)),
  });
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}
