import { describe, it, expect } from 'vitest';
import {
  parseRunbookDefinition,
  validateStepKeyUniqueness,
  validateInputKeyUniqueness,
  computeDefinitionChecksum,
  flattenSteps,
  extractStepKeys,
  getMaxRiskClass,
  requiresAnyAgent,
  requiresAnyApproval,
  isSecretReference,
  extractSecretName,
  collectSecretReferences,
  computePlanDigest,
  computeTriggerFingerprint,
  validateDefinition
} from '@/lib/runbooks/definition';
import {
  RunbookDefinitionError,
  RunbookStepKeyDuplicateError,
  RunbookInputKeyDuplicateError,
} from '@/lib/runbooks/errors';
import type { RunbookDefinition, RunbookStepDefinition } from '@/lib/runbooks/types';

// Helper factories
function createMockStep(overrides: Partial<RunbookStepDefinition> = {}): RunbookStepDefinition {
  return {
    key: 'step1',
    name: 'Step 1',
    description: 'A test step',
    type: 'MANUAL',
    riskClass: 'READ_ONLY',
    config: {},
    requiresApproval: false,
    ...overrides,
  } as RunbookStepDefinition;
}

function createMockDefinition(overrides: Partial<RunbookDefinition> = {}): RunbookDefinition {
  return {
    description: 'Test runbook description',
    steps: [createMockStep()],
    ...overrides,
  };
}

describe('Runbook Definition Module', () => {
  describe('parseRunbookDefinition', () => {
    it('should successfully parse a valid runbook definition', () => {
      const validDef = createMockDefinition();
      const result = parseRunbookDefinition(validDef);
      expect(result).toBeDefined();
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]!.key).toBe('step1');
    });

    it('should throw RunbookDefinitionError for invalid definition', () => {
      const invalidDef = {
        name: 'Missing schemaVersion and steps',
      };
      expect(() => parseRunbookDefinition(invalidDef)).toThrow(RunbookDefinitionError);
    });
  });

  describe('validateStepKeyUniqueness', () => {
    it('should pass for unique step keys', () => {
      const def = createMockDefinition({
        steps: [
          createMockStep({ key: 'step1' }),
          createMockStep({ key: 'step2' }),
        ],
      });
      expect(() => validateStepKeyUniqueness(def)).not.toThrow();
    });

    it('should throw for duplicate step keys at top level', () => {
      const def = createMockDefinition({
        steps: [
          createMockStep({ key: 'step1' }),
          createMockStep({ key: 'step1' }),
        ],
      });
      expect(() => validateStepKeyUniqueness(def)).toThrow(RunbookStepKeyDuplicateError);
    });

    it('should throw for duplicate step keys in nested verification or precheck', () => {
      const def = createMockDefinition({
        steps: [
          createMockStep({
            key: 'step1',
            verification: {
              steps: [createMockStep({ key: 'step2' })],
            },
            precheck: {
              steps: [createMockStep({ key: 'step2' })],
            },
          }),
        ],
      });
      expect(() => validateStepKeyUniqueness(def)).toThrow(RunbookStepKeyDuplicateError);
    });
  });

  describe('validateInputKeyUniqueness', () => {
    it('should pass for unique input keys', () => {
      expect(() =>
        validateInputKeyUniqueness([{ key: 'input1' }, { key: 'input2' }])
      ).not.toThrow();
    });

    it('should throw for duplicate input keys', () => {
      expect(() =>
        validateInputKeyUniqueness([{ key: 'input1' }, { key: 'input1' }])
      ).toThrow(RunbookInputKeyDuplicateError);
    });
  });

  describe('computeDefinitionChecksum', () => {
    it('should compute deterministic checksums', () => {
      const def1 = createMockDefinition();
      const def2 = createMockDefinition();
      
      const sum1 = computeDefinitionChecksum(def1);
      const sum2 = computeDefinitionChecksum(def2);
      
      expect(sum1).toBe(sum2);
    });

    it('should produce different checksums for different definitions', () => {
      const def1 = createMockDefinition({ name: 'One' });
      const def2 = createMockDefinition({ name: 'Two' });
      
      const sum1 = computeDefinitionChecksum(def1);
      const sum2 = computeDefinitionChecksum(def2);
      
      expect(sum1).not.toBe(sum2);
    });
  });

  describe('flattenSteps', () => {
    it('should include top-level, precheck, and verification steps in correct order', () => {
      const def = createMockDefinition({
        steps: [
          createMockStep({
            key: 'main',
            precheck: { steps: [createMockStep({ key: 'pre' })] },
            verification: { steps: [createMockStep({ key: 'post' })] },
          }),
        ],
      });

      const flattened = flattenSteps(def);
      expect(flattened).toHaveLength(3);
      expect(flattened.map(s => s.key)).toEqual(['pre', 'main', 'post']);
    });
  });

  describe('extractStepKeys', () => {
    it('should return all keys including nested ones', () => {
      const def = createMockDefinition({
        steps: [
          createMockStep({
            key: 'main',
            precheck: { steps: [createMockStep({ key: 'pre' })] },
          }),
        ],
      });

      const keys = extractStepKeys(def);
      expect(keys).toEqual(['pre', 'main']);
    });
  });

  describe('getMaxRiskClass', () => {
    it('should identify the highest risk class across steps', () => {
      const def = createMockDefinition({
        steps: [
          createMockStep({ key: '1', riskClass: 'READ_ONLY' }),
          createMockStep({ key: '2', riskClass: 'NON_IDEMPOTENT' }),
          createMockStep({ key: '3', riskClass: 'IDEMPOTENT_WRITE' }),
        ],
      });
      expect(getMaxRiskClass(def)).toBe('NON_IDEMPOTENT');
    });
  });

  describe('requiresAnyAgent', () => {
    it('should return false if all steps are local types', () => {
      const def = createMockDefinition({
        steps: [
          createMockStep({ type: 'MANUAL' }),
          createMockStep({ type: 'HTTP' }),
        ],
      });
      expect(requiresAnyAgent(def)).toBe(false);
    });

    it('should return true if any step is not a local type (e.g. requires agent)', () => {
      const def = createMockDefinition({
        steps: [
          createMockStep({ type: 'MANUAL' }),
          createMockStep({ type: 'SHELL' } as any), // assuming SHELL or some other type requires agent
        ],
      });
      expect(requiresAnyAgent(def)).toBe(true);
    });
  });

  describe('requiresAnyApproval', () => {
    it('should return true if a step is of type APPROVAL', () => {
      const def = createMockDefinition({
        steps: [createMockStep({ type: 'APPROVAL' })],
      });
      expect(requiresAnyApproval(def)).toBe(true);
    });

    it('should return true if a step explicitly requires approval', () => {
      const def = createMockDefinition({
        steps: [createMockStep({ requiresApproval: true })],
      });
      expect(requiresAnyApproval(def)).toBe(true);
    });

    it('should return false if no steps require approval', () => {
      const def = createMockDefinition({
        steps: [createMockStep({ requiresApproval: false, type: 'MANUAL' })],
      });
      expect(requiresAnyApproval(def)).toBe(false);
    });
  });

  describe('isSecretReference & extractSecretName', () => {
    it('should identify and extract valid secret references', () => {
      const ref = 'secret://my-secret-key';
      expect(isSecretReference(ref)).toBe(true);
      expect(extractSecretName(ref)).toBe('my-secret-key');
    });

    it('should reject invalid secret references', () => {
      const notRef = 'not-a-secret';
      expect(isSecretReference(notRef)).toBe(false);
      expect(() => extractSecretName(notRef)).toThrow(RunbookDefinitionError);
    });
  });

  describe('collectSecretReferences', () => {
    it('should extract unique secret names from input values', () => {
      const inputs = {
        param1: 'normal-value',
        param2: 'secret://db-password',
        param3: 'secret://api-key',
        param4: 'secret://db-password',
      };
      const secrets = collectSecretReferences(inputs);
      expect(secrets.size).toBe(2);
      expect(secrets.has('db-password')).toBe(true);
      expect(secrets.has('api-key')).toBe(true);
    });
  });

  describe('computePlanDigest', () => {
    it('should be deterministic and change with fields', () => {
      const plan = {
        stepKey: 's1',
        stepType: 'MANUAL' as const,
        riskClass: 'READ_ONLY' as const,
        config: { foo: 'bar' },
        versionChecksum: 'chk',
      };
      
      const digest1 = computePlanDigest(plan);
      const digest2 = computePlanDigest(plan);
      expect(digest1).toBe(digest2);
      
      const digest3 = computePlanDigest({ ...plan, config: { foo: 'baz' } });
      expect(digest1).not.toBe(digest3);
    });
  });

  describe('computeTriggerFingerprint', () => {
    it('should be deterministic and unique per input', () => {
      const input = {
        sourceEventId: 'ev1',
        bindingId: 'b1',
        runbookVersionId: 'v1',
      };
      
      const fp1 = computeTriggerFingerprint(input);
      const fp2 = computeTriggerFingerprint(input);
      expect(fp1).toBe(fp2);
      
      const fp3 = computeTriggerFingerprint({ ...input, sourceEventId: 'ev2' });
      expect(fp1).not.toBe(fp3);
    });
  });

  describe('validateDefinition', () => {
    it('should return summary for valid definition', () => {
      const def = createMockDefinition({
        steps: [
          createMockStep({ key: 's1', riskClass: 'NON_IDEMPOTENT', requiresApproval: true })
        ],
      });
      const result = validateDefinition(def);
      
      expect(result.valid).toBe(true);
      expect(result.stepCount).toBe(1);
      expect(result.maxRisk).toBe('NON_IDEMPOTENT');
      expect(result.requiresApproval).toBe(true);
      expect(result.stepKeys).toEqual(['s1']);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for invalid definition', () => {
      const invalidDef = { name: 'Oops' };
      const result = validateDefinition(invalidDef);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
    
    it('should return errors for duplicate step keys', () => {
      // Create a struct that parses cleanly but has duplicates.
      const def = createMockDefinition({
        steps: [
          createMockStep({ key: 'dup' }),
          createMockStep({ key: 'dup' }),
        ],
      });
      const result = validateDefinition(def);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate step key: "dup"'))).toBe(true);
    });
  });
});
