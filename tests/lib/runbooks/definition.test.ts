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
  containsSecretReference,
  resolveInputTemplates,
  computePlanDigest,
  computeTriggerFingerprint,
  validateDefinition,
  referencedStepInputKeys,
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
    it.each(['NOT_EXISTS', 'NOT_EQUALS'])('rejects typo fields with %s', operator => {
      for (const field of [
        'incident.severityTYPO',
        'service.invalid',
        'whatever',
        'input.foo.bar',
      ]) {
        const definition = createMockDefinition({
          steps: [
            createMockStep({
              type: 'CONDITION',
              config: { field, operator, value: 'P1' },
            }),
          ],
        });
        expect(() => parseRunbookDefinition(definition, [])).toThrow(RunbookDefinitionError);
      }
    });

    it('rejects invalid operators and undeclared input paths, including nested checks', () => {
      const gate = createMockStep({
        type: 'CONDITION',
        config: { field: 'input.environment', operator: 'NOT_EXISTS' },
      });
      const definition = createMockDefinition({ steps: [gate] });
      expect(() => parseRunbookDefinition(definition, [])).toThrow(/undeclared/);
      expect(parseRunbookDefinition(definition, [{ key: 'environment' }])).toBeDefined();
      const nested = createMockDefinition({
        steps: [createMockStep({ key: 'parent', precheck: { steps: [gate] } })],
      });
      expect(() => parseRunbookDefinition(nested, [])).toThrow(/undeclared/);
      gate.config = { field: 'incident.priority', operator: 'NOT_EXIST' };
      expect(() => parseRunbookDefinition(definition)).toThrow(/operator/);
    });

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

    it('rejects risk declarations below executable semantics', () => {
      const definition = createMockDefinition({
        steps: [
          createMockStep({
            type: 'SYSTEMD',
            riskClass: 'READ_ONLY',
            config: { action: 'restart', unit: 'api.service' },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(definition)).toThrow(/NON_IDEMPOTENT/);
    });

    it('rejects unsafe target syntax and unsupported delayed verification', () => {
      const unsafeTarget = createMockDefinition({
        steps: [
          createMockStep({
            type: 'DOCKER',
            config: { action: 'inspect', container: '--host=attacker' },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(unsafeTarget)).toThrow(/invalid Docker container/);

      const delayedVerification = createMockDefinition({
        steps: [
          createMockStep({
            verification: { delaySeconds: 10, steps: [createMockStep({ key: 'verify' })] },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(delayedVerification)).toThrow(/explicit WAIT/);
    });
  });

  describe('validateStepKeyUniqueness', () => {
    it('should pass for unique step keys', () => {
      const def = createMockDefinition({
        steps: [createMockStep({ key: 'step1' }), createMockStep({ key: 'step2' })],
      });
      expect(() => validateStepKeyUniqueness(def)).not.toThrow();
    });

    it('should throw for duplicate step keys at top level', () => {
      const def = createMockDefinition({
        steps: [createMockStep({ key: 'step1' }), createMockStep({ key: 'step1' })],
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
      expect(() => validateInputKeyUniqueness([{ key: 'input1' }, { key: 'input1' }])).toThrow(
        RunbookInputKeyDuplicateError
      );
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
      const def1 = createMockDefinition({
        steps: [createMockStep({ config: { command: 'status' } })],
      });
      const def2 = createMockDefinition({
        steps: [createMockStep({ config: { command: 'restart' } })],
      });

      const sum1 = computeDefinitionChecksum(def1);
      const sum2 = computeDefinitionChecksum(def2);

      expect(sum1).not.toBe(sum2);
    });

    it('is independent of nested object key insertion order', () => {
      const def1 = createMockDefinition({
        steps: [createMockStep({ config: { host: 'api.internal', port: 443 } })],
      });
      const def2 = createMockDefinition({
        steps: [createMockStep({ config: { port: 443, host: 'api.internal' } })],
      });

      expect(computeDefinitionChecksum(def1)).toBe(computeDefinitionChecksum(def2));
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

    it('recursively expands nested prechecks and verification', () => {
      const def = createMockDefinition({
        steps: [
          createMockStep({
            key: 'main',
            precheck: {
              steps: [
                createMockStep({
                  key: 'pre',
                  verification: { steps: [createMockStep({ key: 'nested-verify' })] },
                }),
              ],
            },
          }),
        ],
      });
      expect(flattenSteps(def).map(step => step.key)).toEqual(['pre', 'nested-verify', 'main']);
    });
  });

  describe('resolveInputTemplates', () => {
    it('preserves exact input types and interpolates scalar text', () => {
      expect(
        resolveInputTemplates(
          { replicas: '${{ inputs.count }}', url: 'https://${{ inputs.host }}/health' },
          { count: 3, host: 'api.internal' }
        )
      ).toEqual({ replicas: 3, url: 'https://api.internal/health' });
    });

    it('fails closed for missing and non-scalar embedded inputs', () => {
      expect(() => resolveInputTemplates('${{ inputs.missing }}', {})).toThrow(/Missing required/);
      expect(() => resolveInputTemplates('value=${{ inputs.value }}', { value: {} })).toThrow(
        /must be scalar/
      );
    });

    it('detects nested secret references', () => {
      expect(containsSecretReference({ headers: ['secret://api-key'] })).toBe(true);
      expect(containsSecretReference({ headers: ['public'] })).toBe(false);
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
        steps: [createMockStep({ type: 'MANUAL' }), createMockStep({ type: 'HTTP' })],
      });
      expect(requiresAnyAgent(def)).toBe(false);
    });

    it('should return true if any step is not a local type (e.g. requires agent)', () => {
      const def = createMockDefinition({
        steps: [createMockStep({ type: 'MANUAL' }), createMockStep({ type: 'BASH' })],
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
        steps: [createMockStep({ key: 's1', riskClass: 'NON_IDEMPOTENT', requiresApproval: true })],
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
        steps: [createMockStep({ key: 'dup' }), createMockStep({ key: 'dup' })],
      });
      const result = validateDefinition(def);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate step key: "dup"'))).toBe(true);
    });
  });

  describe('size limits and k8s action/resource compatibility', () => {
    it('rejects definitions exceeding the 256 KiB size limit', () => {
      const steps: RunbookStepDefinition[] = [];
      for (let i = 0; i < 20; i++) {
        steps.push(
          createMockStep({
            key: `step_${i}`,
            type: 'BASH',
            riskClass: 'NON_IDEMPOTENT',
            config: { command: 'echo hello', padding: 'x'.repeat(14 * 1024) },
          })
        );
      }
      const def = createMockDefinition({ steps });
      expect(() => parseRunbookDefinition(def)).toThrow(
        'Runbook definition exceeds maximum allowed size of 256 KiB.'
      );
    });

    it('rejects step configs exceeding the 32 KiB size limit on non-HTTP steps', () => {
      const hugeConfig = {
        command: 'echo ok',
        extraPadding: 'y'.repeat(33 * 1024),
      };
      const def = createMockDefinition({
        steps: [
          createMockStep({
            type: 'BASH',
            riskClass: 'NON_IDEMPOTENT',
            config: hugeConfig,
          }),
        ],
      });
      expect(() => parseRunbookDefinition(def)).toThrow(
        'config exceeds maximum allowed size of 32 KiB.'
      );
    });

    it('enforces BASH command size limit of 8 KiB', () => {
      const longCommand = 'echo ' + 'a'.repeat(8193);
      const def = createMockDefinition({
        steps: [
          createMockStep({
            type: 'BASH',
            riskClass: 'NON_IDEMPOTENT',
            config: { command: longCommand },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(def)).toThrow(
        'Bash command exceeds maximum allowed size of 8 KiB.'
      );
    });

    it('enforces HTTP header entry count and size limits', () => {
      // More than 64 header entries
      const headers65: Record<string, string> = {};
      for (let i = 0; i < 65; i++) {
        headers65[`X-Header-${i}`] = 'val';
      }
      const defCount = createMockDefinition({
        steps: [
          createMockStep({
            type: 'HTTP',
            riskClass: 'READ_ONLY',
            config: {
              url: 'https://example.com/api',
              method: 'GET',
              headers: headers65,
            },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(defCount)).toThrow(
        'HTTP headers exceed maximum allowed count of 64 entries.'
      );

      // Header size exceeding 16 KiB
      const defSize = createMockDefinition({
        steps: [
          createMockStep({
            type: 'HTTP',
            riskClass: 'READ_ONLY',
            config: {
              url: 'https://example.com/api',
              method: 'GET',
              headers: { 'X-Large': 'z'.repeat(17 * 1024) },
            },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(defSize)).toThrow(
        'HTTP headers exceed maximum allowed size of 16 KiB.'
      );
    });

    it('enforces HTTP body size limit of 64 KiB', () => {
      const largeBody = 'b'.repeat(65 * 1024);
      const def = createMockDefinition({
        steps: [
          createMockStep({
            type: 'HTTP',
            riskClass: 'NON_IDEMPOTENT',
            config: {
              url: 'https://example.com/api',
              method: 'POST',
              body: largeBody,
            },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(def)).toThrow(
        'HTTP body exceeds maximum allowed size of 64 KiB.'
      );
    });

    it('validates Kubernetes action and resource compatibility matrix', () => {
      // logs accepts Pods, Deployment, DaemonSet, StatefulSet
      for (const res of ['pod', 'pods', 'deployment', 'statefulset', 'daemonset']) {
        const validLogsDef = createMockDefinition({
          steps: [
            createMockStep({
              type: 'KUBERNETES',
              riskClass: 'READ_ONLY',
              config: { action: 'logs', resource: res, name: 'my-resource' },
            }),
          ],
        });
        expect(() => parseRunbookDefinition(validLogsDef)).not.toThrow();
      }

      // logs rejects unsupported resources like service
      const invalidLogsDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'KUBERNETES',
            riskClass: 'READ_ONLY',
            config: { action: 'logs', resource: 'service', name: 'my-service' },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(invalidLogsDef)).toThrow(
        'Kubernetes logs action does not support resource "service"'
      );

      // rollout-restart accepts Deployment, DaemonSet, StatefulSet
      const validRolloutDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'KUBERNETES',
            riskClass: 'NON_IDEMPOTENT',
            config: { action: 'rollout-restart', resource: 'deployment', name: 'my-deploy' },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(validRolloutDef)).not.toThrow();

      // rollout-restart rejects Pod
      const invalidRolloutDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'KUBERNETES',
            riskClass: 'NON_IDEMPOTENT',
            config: { action: 'rollout-restart', resource: 'pod', name: 'my-pod' },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(invalidRolloutDef)).toThrow(
        'Kubernetes rollout-restart does not support resource "pod"'
      );

      // scale accepts Deployment, StatefulSet, ReplicaSet, ReplicationController
      const validScaleDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'KUBERNETES',
            riskClass: 'IDEMPOTENT_WRITE',
            config: { action: 'scale', resource: 'statefulset', name: 'my-sts', replicas: 3 },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(validScaleDef)).not.toThrow();

      // scale rejects Pod
      const invalidScaleDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'KUBERNETES',
            riskClass: 'IDEMPOTENT_WRITE',
            config: { action: 'scale', resource: 'pod', name: 'my-pod', replicas: 3 },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(invalidScaleDef)).toThrow(
        'Kubernetes scale action does not support resource "pod"'
      );

      // scale accepts replica template bound to NUMBER input
      const templatedScaleDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'KUBERNETES',
            riskClass: 'IDEMPOTENT_WRITE',
            config: {
              action: 'scale',
              resource: 'deployment',
              name: 'my-deploy',
              replicas: '${{ inputs.replica_count }}',
            },
          }),
        ],
      });
      expect(() =>
        parseRunbookDefinition(templatedScaleDef, [{ key: 'replica_count', type: 'NUMBER' }])
      ).not.toThrow();

      // scale rejects replica template bound to STRING input
      expect(() =>
        parseRunbookDefinition(templatedScaleDef, [{ key: 'replica_count', type: 'STRING' }])
      ).toThrow(/must be NUMBER/);

      // scale rejects replica template bound to undeclared input
      expect(() => parseRunbookDefinition(templatedScaleDef, [])).toThrow(/undeclared replica input/);
    });

    it('referencedStepInputKeys extracts template references, bare and prefixed Bash env vars, and condition inputs', () => {
      // 1. Template references in HTTP step
      const httpStep = createMockStep({
        type: 'HTTP',
        config: {
          method: 'POST',
          url: 'https://api.internal/${{ inputs.target_host }}',
          body: { apiKey: '${{ inputs.api_key }}' },
        },
      });
      const httpKeys = referencedStepInputKeys(httpStep);
      expect(httpKeys.has('target_host')).toBe(true);
      expect(httpKeys.has('api_key')).toBe(true);

      // 2. Bare, $, ${}, and % Bash environment references
      const bashStep = createMockStep({
        type: 'BASH',
        config: {
          command:
            'echo "$OPSKNIGHT_INPUT_DB_HOST" && printenv OPSKNIGHT_INPUT_DB_PASS && echo ${OPSKNIGHT_INPUT_DB_PORT}',
        },
      });
      const bashKeys = referencedStepInputKeys(bashStep);
      expect(bashKeys.has('db_host')).toBe(true);
      expect(bashKeys.has('db_pass')).toBe(true);
      expect(bashKeys.has('db_port')).toBe(true);

      // 3. Condition field inputs (input.<key> and inputs.<key>)
      const condStep1 = createMockStep({
        type: 'CONDITION',
        config: { field: 'input.maintenance_window', operator: 'EQUALS', value: 'yes' },
      });
      const condStep2 = createMockStep({
        type: 'CONDITION',
        config: { field: 'inputs.service_flag', operator: 'EQUALS', value: true },
      });
      expect(referencedStepInputKeys(condStep1).has('maintenance_window')).toBe(true);
      expect(referencedStepInputKeys(condStep2).has('service_flag')).toBe(true);
    });

    it('rejects undeclared inputs across all step types (HTTP, SYSTEMD, DOCKER, KUBERNETES, BASH)', () => {
      // HTTP undeclared url template
      const httpDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'HTTP',
            config: { method: 'GET', url: 'https://internal.net/${{ inputs.unregistered_host }}' },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(httpDef, [])).toThrow(
        /references undeclared input "unregistered_host"/
      );
      expect(
        parseRunbookDefinition(httpDef, [{ key: 'unregistered_host', type: 'STRING' }])
      ).toBeDefined();

      // Systemd undeclared unit template
      const systemdDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'SYSTEMD',
            config: { action: 'status', unit: '${{ inputs.unregistered_unit }}' },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(systemdDef, [])).toThrow(
        /references undeclared input "unregistered_unit"/
      );

      // Docker undeclared container template
      const dockerDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'DOCKER',
            config: { action: 'inspect', container: '${{ inputs.unregistered_container }}' },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(dockerDef, [])).toThrow(
        /references undeclared input "unregistered_container"/
      );

      // Kubernetes undeclared namespace template
      const k8sDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'KUBERNETES',
            config: {
              action: 'get',
              resource: 'pods',
              namespace: '${{ inputs.unregistered_namespace }}',
            },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(k8sDef, [])).toThrow(
        /references undeclared input "unregistered_namespace"/
      );

      // Bash undeclared bare environment variable
      const bashDef = createMockDefinition({
        steps: [
          createMockStep({
            type: 'BASH',
            riskClass: 'NON_IDEMPOTENT',
            config: { command: 'printenv OPSKNIGHT_INPUT_UNREGISTERED_SECRET' },
          }),
        ],
      });
      expect(() => parseRunbookDefinition(bashDef, [])).toThrow(
        /references undeclared input "unregistered_secret"/
      );
    });
  });
});

