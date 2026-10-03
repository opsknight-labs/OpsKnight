/**
 * OpsKnight Runbooks — Definition parsing, validation, and integrity utilities.
 *
 * This module handles:
 * - Parsing and validating runbook definition JSON
 * - Computing deterministic checksums for version immutability
 * - Extracting step metadata for execution planning
 * - Resolving input references (including secret:// references)
 */

import crypto from 'crypto';
import { runbookDefinitionSchema } from './schemas';
import {
  RunbookDefinitionError,
  RunbookStepKeyDuplicateError,
  RunbookInputKeyDuplicateError,
} from './errors';
import type {
  RunbookDefinition,
  RunbookStepDefinition,
  RunbookRiskClass,
  RunbookStepType,
} from './types';
import { MAX_RUNBOOK_STEPS, MAX_RUNBOOK_INPUTS } from './types';

// ---------------------------------------------------------------------------
// Parse and validate
// ---------------------------------------------------------------------------

/**
 * Parses and validates a runbook definition from raw JSON.
 * Throws `RunbookDefinitionError` on validation failure.
 */
export function parseRunbookDefinition(raw: unknown): RunbookDefinition {
  const result = runbookDefinitionSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    throw new RunbookDefinitionError(
      `Invalid runbook definition: ${issues.join('; ')}`,
      { issues: result.error.issues }
    );
  }
  return result.data as RunbookDefinition;
}

/**
 * Validates that all step keys within a definition are unique.
 */
export function validateStepKeyUniqueness(definition: RunbookDefinition): void {
  const keys = new Set<string>();
  const stack: RunbookStepDefinition[] = [...definition.steps];

  while (stack.length > 0) {
    const step = stack.pop()!;
    if (keys.has(step.key)) {
      throw new RunbookStepKeyDuplicateError(step.key);
    }
    keys.add(step.key);

    // Check nested verification and precheck steps
    if (step.verification?.steps) {
      stack.push(...step.verification.steps);
    }
    if (step.precheck?.steps) {
      stack.push(...step.precheck.steps);
    }
  }
}

/**
 * Validates that all input keys within a set of inputs are unique.
 */
export function validateInputKeyUniqueness(
  inputs: Array<{ key: string }>
): void {
  const keys = new Set<string>();
  for (const input of inputs) {
    if (keys.has(input.key)) {
      throw new RunbookInputKeyDuplicateError(input.key);
    }
    keys.add(input.key);
  }
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic SHA-256 checksum of a runbook definition.
 * The checksum is used to verify immutability of published versions
 * and for approval plan digest verification.
 */
export function computeDefinitionChecksum(definition: RunbookDefinition): string {
  const canonical = canonicalizeDefinition(definition);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Produces a deterministic JSON representation of a definition,
 * suitable for checksumming. Keys are sorted at every level.
 */
function canonicalizeDefinition(definition: RunbookDefinition): string {
  return JSON.stringify(definition, Object.keys(definition).sort());
}

// ---------------------------------------------------------------------------
// Step metadata extraction
// ---------------------------------------------------------------------------

/**
 * Flattens all steps in a definition into a sequenced list,
 * including nested verification and precheck steps.
 */
export function flattenSteps(definition: RunbookDefinition): RunbookStepDefinition[] {
  const result: RunbookStepDefinition[] = [];
  for (const step of definition.steps) {
    if (step.precheck?.steps) {
      result.push(...step.precheck.steps);
    }
    result.push(step);
    if (step.verification?.steps) {
      result.push(...step.verification.steps);
    }
  }
  return result;
}

/**
 * Extracts all unique step keys from a definition.
 */
export function extractStepKeys(definition: RunbookDefinition): string[] {
  return flattenSteps(definition).map((s) => s.key);
}

/**
 * Returns the maximum risk class across all steps in a definition.
 * Useful for determining overall runbook risk level.
 */
export function getMaxRiskClass(definition: RunbookDefinition): RunbookRiskClass {
  const riskOrder: Record<RunbookRiskClass, number> = {
    READ_ONLY: 0,
    IDEMPOTENT_WRITE: 1,
    NON_IDEMPOTENT: 2,
  };

  let maxRisk: RunbookRiskClass = 'READ_ONLY';

  for (const step of flattenSteps(definition)) {
    if (riskOrder[step.riskClass] > riskOrder[maxRisk]) {
      maxRisk = step.riskClass;
    }
  }

  return maxRisk;
}

/**
 * Returns true if any step in the definition requires an agent.
 */
export function requiresAnyAgent(definition: RunbookDefinition): boolean {
  const localTypes: ReadonlySet<RunbookStepType> = new Set([
    'MANUAL',
    'APPROVAL',
    'CONDITION',
    'WAIT',
    'HTTP',
  ]);

  return flattenSteps(definition).some((step) => !localTypes.has(step.type));
}

/**
 * Returns true if any step in the definition requires approval.
 */
export function requiresAnyApproval(definition: RunbookDefinition): boolean {
  return flattenSteps(definition).some(
    (step) => step.type === 'APPROVAL' || step.requiresApproval === true
  );
}

// ---------------------------------------------------------------------------
// Input value resolution
// ---------------------------------------------------------------------------

const SECRET_REF_PREFIX = 'secret://';

/**
 * Checks if a value is a secret reference (e.g., "secret://prod-db-password").
 */
export function isSecretReference(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SECRET_REF_PREFIX);
}

/**
 * Extracts the secret name from a secret reference string.
 */
export function extractSecretName(ref: string): string {
  if (!ref.startsWith(SECRET_REF_PREFIX)) {
    throw new RunbookDefinitionError(`Invalid secret reference: "${ref}"`);
  }
  return ref.slice(SECRET_REF_PREFIX.length);
}

/**
 * Resolves all secret references within input values, returning the set
 * of secret names that need to be fetched.
 */
export function collectSecretReferences(
  inputValues: Record<string, unknown>
): Set<string> {
  const secrets = new Set<string>();
  for (const value of Object.values(inputValues)) {
    if (isSecretReference(value)) {
      secrets.add(extractSecretName(value));
    }
  }
  return secrets;
}

// ---------------------------------------------------------------------------
// Plan digest (for approval verification)
// ---------------------------------------------------------------------------

/**
 * Computes a SHA-256 digest of the execution plan for approval verification.
 * The digest covers the action, target, arguments, version, risk class,
 * agent pool, and verification plan — ensuring that what was approved is
 * exactly what gets executed.
 */
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
  const canonical = JSON.stringify({
    stepKey: plan.stepKey,
    stepType: plan.stepType,
    riskClass: plan.riskClass,
    config: plan.config,
    agentPoolId: plan.agentPoolId ?? null,
    agentId: plan.agentId ?? null,
    inputValues: plan.inputValues ?? {},
    versionChecksum: plan.versionChecksum,
  });
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

// ---------------------------------------------------------------------------
// Validation summary
// ---------------------------------------------------------------------------

export interface DefinitionValidationResult {
  valid: boolean;
  stepCount: number;
  maxRisk: RunbookRiskClass;
  requiresAgent: boolean;
  requiresApproval: boolean;
  stepKeys: string[];
  errors: string[];
}

/**
 * Performs a comprehensive validation of a runbook definition and returns
 * a summary suitable for UI display.
 */
export function validateDefinition(raw: unknown): DefinitionValidationResult {
  const errors: string[] = [];

  const parseResult = runbookDefinitionSchema.safeParse(raw);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return {
      valid: false,
      stepCount: 0,
      maxRisk: 'READ_ONLY',
      requiresAgent: false,
      requiresApproval: false,
      stepKeys: [],
      errors,
    };
  }

  const definition = parseResult.data as RunbookDefinition;

  // Check step key uniqueness
  const keys = new Set<string>();
  for (const step of flattenSteps(definition)) {
    if (keys.has(step.key)) {
      errors.push(`Duplicate step key: "${step.key}"`);
    }
    keys.add(step.key);
  }

  return {
    valid: errors.length === 0,
    stepCount: definition.steps.length,
    maxRisk: getMaxRiskClass(definition),
    requiresAgent: requiresAnyAgent(definition),
    requiresApproval: requiresAnyApproval(definition),
    stepKeys: [...keys],
    errors,
  };
}
