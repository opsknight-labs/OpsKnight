import { describe, it, expect } from 'vitest';
import {
  createRunbookSchema,
  runbookDefinitionSchema,
  runbookStepDefinitionSchema,
  createServiceRunbookBindingSchema,
  createRunbookTriggerSchema,
  startRunbookExecutionSchema,
  approveRunbookStepSchema,
  agentJobResultSchema,
  agentArtifactSchema,
  createRunbookSecretSchema,
  runbookInputSchema,
} from '@/lib/runbooks/schemas';

describe('Runbooks Zod Schemas', () => {
  it.each(['NOT_EXISTS', 'NOT_EQUALS'])('rejects unsupported trigger fields with %s', operator => {
    for (const field of [
      'incident.severityTYPO',
      'service.invalid',
      'whatever',
      'input.environment',
    ]) {
      expect(
        createRunbookTriggerSchema.safeParse({
          event: 'INCIDENT_CREATED',
          conditions: [{ field, operator, value: 'P1' }],
        }).success
      ).toBe(false);
    }
    expect(
      createRunbookTriggerSchema.safeParse({
        event: 'INCIDENT_CREATED',
        conditions: [{ field: 'incident.priority', operator, value: 'P1' }],
      }).success
    ).toBe(true);
  });
  it('rejects unconstrained SELECT input definitions', () => {
    expect(
      runbookInputSchema.safeParse({ key: 'environment', label: 'Environment', type: 'SELECT' })
        .success
    ).toBe(false);
  });
  describe('createRunbookSchema', () => {
    it('should validate valid runbook creation input', () => {
      const result = createRunbookSchema.safeParse({
        name: 'My Runbook',
        slug: 'my-runbook-1',
        description: 'A test runbook',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid slug', () => {
      const result = createRunbookSchema.safeParse({
        name: 'My Runbook',
        slug: 'My_Runbook', // uppercase and underscore not allowed
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('lowercase alphanumeric with hyphens');
      }
    });

    it('should require name and slug', () => {
      const result = createRunbookSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('runbookStepDefinitionSchema', () => {
    it('should validate a valid step definition', () => {
      const result = runbookStepDefinitionSchema.safeParse({
        key: 'step_1',
        name: 'First Step',
        type: 'BASH',
        riskClass: 'READ_ONLY',
      });
      expect(result.success).toBe(true);
    });

    it('should apply default risk class if omitted', () => {
      const result = runbookStepDefinitionSchema.safeParse({
        key: 'step_2',
        name: 'Second Step',
        type: 'HTTP',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.riskClass).toBe('READ_ONLY');
      }
    });

    it('should reject invalid step type', () => {
      const result = runbookStepDefinitionSchema.safeParse({
        key: 'step_3',
        name: 'Third Step',
        type: 'INVALID_TYPE',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid key format', () => {
      const result = runbookStepDefinitionSchema.safeParse({
        key: 'invalid key!',
        name: 'Step',
        type: 'BASH',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('runbookDefinitionSchema', () => {
    it('should validate a valid runbook definition', () => {
      const result = runbookDefinitionSchema.safeParse({
        steps: [
          {
            key: 'step_1',
            name: 'Step 1',
            type: 'BASH',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should reject duplicate step keys', () => {
      const result = runbookDefinitionSchema.safeParse({
        steps: [
          { key: 'step_1', name: 'Step 1', type: 'BASH' },
          { key: 'step_1', name: 'Step 2', type: 'HTTP' },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Duplicate step key: "step_1"');
      }
    });

    it('should require at least one step', () => {
      const result = runbookDefinitionSchema.safeParse({ steps: [] });
      expect(result.success).toBe(false);
    });

    it('should enforce maximum step limits', () => {
      // Assuming MAX_RUNBOOK_STEPS is something we exceed here (e.g. 50+ usually, let's just make it fail if needed, or just test it exists)
      const steps = Array.from({ length: 101 }, (_, i) => ({
        key: `step_${i}`,
        name: `Step ${i}`,
        type: 'BASH',
      }));
      const result = runbookDefinitionSchema.safeParse({ steps });
      expect(result.success).toBe(false);
    });
  });

  describe('createServiceRunbookBindingSchema', () => {
    it('should validate basic valid binding', () => {
      // Need real cuid for validation? Zod's .cuid() validates string length and format.
      // A standard cuid is usually ~25 chars starting with c, let's use a valid looking one.
      const validCuid = 'ckopq1234000001la8m123456';
      const res2 = createServiceRunbookBindingSchema.safeParse({
        runbookId: validCuid,
      });
      expect(res2.success).toBe(true);
    });

    it('should warn/fail if AUTOMATIC and LATEST_PUBLISHED', () => {
      const validCuid = 'ckopq1234000001la8m123456';
      const result = createServiceRunbookBindingSchema.safeParse({
        runbookId: validCuid,
        mode: 'AUTOMATIC',
        versionStrategy: 'LATEST_PUBLISHED',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'Automatic execution mode should use PINNED'
        );
      }
    });

    it('should reject PINNED without runbookVersionId', () => {
      const validCuid = 'ckopq1234000001la8m123456';
      const result = createServiceRunbookBindingSchema.safeParse({
        runbookId: validCuid,
        versionStrategy: 'PINNED',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'specific runbook version must be selected'
        );
      }
    });
  });

  describe('createRunbookTriggerSchema', () => {
    it('should validate valid trigger', () => {
      const result = createRunbookTriggerSchema.safeParse({
        event: 'INCIDENT_CREATED',
        conditions: [
          {
            field: 'incident.priority',
            operator: 'EQUALS',
            value: 'P1',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const result = createRunbookTriggerSchema.safeParse({
        event: 'INCIDENT_CREATED',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conditionLogic).toBe('AND');
        expect(result.data.conditions).toEqual([]);
      }
    });

    it('rejects trigger events that do not have a runtime producer yet', () => {
      expect(createRunbookTriggerSchema.safeParse({ event: 'INCIDENT_UPDATED' }).success).toBe(
        false
      );
    });
  });

  describe('startRunbookExecutionSchema', () => {
    it('should require runbookId', () => {
      const result = startRunbookExecutionSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should validate with valid cuid runbookId', () => {
      const validCuid = 'ckopq1234000001la8m123456';
      const result = startRunbookExecutionSchema.safeParse({
        runbookId: validCuid,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.inputValues).toEqual({});
      }
    });
  });

  describe('approveRunbookStepSchema', () => {
    it('should validate valid approval', () => {
      const result = approveRunbookStepSchema.safeParse({
        executionId: 'ckopq1234000001la8m123456',
        stepId: 'ckopq1234000001la8m123457',
        planDigest: 'abcdef1234567890',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing plan digest', () => {
      const result = approveRunbookStepSchema.safeParse({
        executionId: 'ckopq1234000001la8m123456',
        stepId: 'ckopq1234000001la8m123457',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('agentJobResultSchema', () => {
    it('should validate valid result', () => {
      const result = agentJobResultSchema.safeParse({
        attemptId: 'ckopq1234000001la8m123456',
        leaseToken: 'token123',
        status: 'SUCCEEDED',
        exitCode: 0,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = agentJobResultSchema.safeParse({
        attemptId: 'ckopq1234000001la8m123456',
        leaseToken: 'token123',
        status: 'DONE',
      });
      expect(result.success).toBe(false);
    });

    it('accepts explicit cancellation acknowledgements', () => {
      const result = agentJobResultSchema.safeParse({
        attemptId: 'ckopq1234000001la8m123456',
        leaseToken: 'token123',
        status: 'CANCELLED',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('agentArtifactSchema', () => {
    const artifact = {
      attemptId: 'ckopq1234000001la8m123456',
      leaseToken: 'token123',
      kind: 'OUTPUT',
      mediaType: 'text/plain',
      encoding: 'gzip',
      contentBase64: Buffer.from('compressed').toString('base64'),
      sha256: 'a'.repeat(64),
      truncated: false,
    };

    it('accepts bounded gzip output metadata', () => {
      expect(agentArtifactSchema.safeParse(artifact).success).toBe(true);
    });

    it('rejects unsupported encodings and invalid checksums', () => {
      expect(agentArtifactSchema.safeParse({ ...artifact, encoding: 'identity' }).success).toBe(
        false
      );
      expect(agentArtifactSchema.safeParse({ ...artifact, sha256: '../bad' }).success).toBe(false);
    });
  });

  describe('createRunbookSecretSchema', () => {
    it('should validate valid secret creation', () => {
      const result = createRunbookSecretSchema.safeParse({
        name: 'my-secret',
        value: 'super-secret-value',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid name format', () => {
      const result = createRunbookSecretSchema.safeParse({
        name: 'My_Secret',
        value: 'value',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('runbookInputSchema', () => {
    it('should validate valid input schema', () => {
      const result = runbookInputSchema.safeParse({
        key: 'input_key',
        label: 'Input Key',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('STRING');
        expect(result.data.sequence).toBe(0);
      }
    });

    it('should reject invalid key format', () => {
      const result = runbookInputSchema.safeParse({
        key: 'input-key', // hyphens not allowed here, only underscores
        label: 'Input Key',
      });
      expect(result.success).toBe(false);
    });
  });
});
