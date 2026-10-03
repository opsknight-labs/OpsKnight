import type { RunbookRiskClass, RunbookStepDefinition, RunbookStepType } from './types';

const MAX_RETRY_DELAY_MS = 60_000;

export function stepRequiresApproval(
  step: Pick<RunbookStepDefinition, 'type' | 'riskClass' | 'requiresApproval'>
): boolean {
  return (
    step.type === 'APPROVAL' ||
    step.type === 'MANUAL' ||
    step.riskClass === 'NON_IDEMPOTENT' ||
    step.requiresApproval === true
  );
}

export function agentSupportsStep(capabilities: readonly string[], type: RunbookStepType): boolean {
  const supported = new Set(capabilities);
  return supported.has('*') || supported.has(type) || supported.has(`RUNBOOK_${type}`);
}

export function retryDelayMs(attemptNumber: number): number {
  const exponent = Math.max(0, Math.min(10, attemptNumber - 1));
  return Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** exponent);
}

export function canAutomaticallyRetryUnknown(riskClass: RunbookRiskClass): boolean {
  return riskClass === 'READ_ONLY';
}
