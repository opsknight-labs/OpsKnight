import crypto from 'crypto';
import { sortJsonValue } from './shared-definition';
import type { RunbookDefinition, RunbookStepType, RunbookRiskClass } from './types';
export * from './shared-definition';

export function computeDefinitionChecksum(definition: RunbookDefinition): string {
  const canonical = canonicalizeDefinition(definition);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Produces a deterministic JSON representation of a definition,
 * suitable for checksumming. Keys are sorted at every level.
 */
function canonicalizeDefinition(definition: RunbookDefinition): string {
  return JSON.stringify(sortJsonValue(definition));
}

export function computePlanDigest(plan: {
  stepKey: string;
  stepType: RunbookStepType;
  riskClass: RunbookRiskClass;
  config: Record<string, unknown>;
  agentPoolId?: string;
  agentId?: string;
  inputValues?: Record<string, unknown>;
  versionChecksum: string;
}): string {
  const canonical = JSON.stringify(
    sortJsonValue({
      stepKey: plan.stepKey,
      stepType: plan.stepType,
      riskClass: plan.riskClass,
      config: plan.config,
      agentPoolId: plan.agentPoolId ?? null,
      agentId: plan.agentId ?? null,
      inputValues: plan.inputValues ?? {},
      versionChecksum: plan.versionChecksum,
    })
  );
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// ---------------------------------------------------------------------------
// Trigger fingerprint (for deduplication)
// ---------------------------------------------------------------------------

/**
 * Computes a trigger fingerprint for execution deduplication.
 * Same fingerprint = same logical execution; unique constraint prevents duplicates.
 */
export function computeTriggerFingerprint(input: {
  sourceEventId: string;
  bindingId: string;
  runbookVersionId: string;
}): string {
  const payload = `${input.sourceEventId}:${input.bindingId}:${input.runbookVersionId}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}
