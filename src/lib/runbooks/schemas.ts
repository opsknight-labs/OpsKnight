/**
 * OpsKnight Runbooks — Zod validation schemas.
 *
 * These schemas validate external input at API boundaries: creation, update,
 * binding, trigger configuration, and execution requests. They follow
 * OpsKnight's existing Zod patterns (strict objects, trim, z.infer exports).
 */

import { z } from 'zod';
import {
  RUNBOOK_BINDING_MODES,
  RUNBOOK_CONDITION_LOGICS,
  RUNBOOK_CONDITION_OPERATORS,
  RUNBOOK_INPUT_TYPES,
  RUNBOOK_RISK_CLASSES,
  RUNBOOK_STEP_TYPES,
  RUNBOOK_VERSION_STRATEGIES,
  MAX_RUNBOOK_STEPS,
  MAX_RUNBOOK_INPUTS,
} from './types';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const runbookSlugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(120)
  .regex(slugRegex, 'Slug must be lowercase alphanumeric with hyphens');

export const runbookNameSchema = z.string().trim().min(1, 'Name is required').max(200);

export const runbookDescriptionSchema = z.string().trim().max(5000).default('');

export const stepKeySchema = z
  .string()
  .trim()
  .min(1, 'Step key is required')
  .max(80)
  .regex(/^[a-z0-9_-]+$/, 'Step key must be lowercase alphanumeric with underscores or hyphens');

// ---------------------------------------------------------------------------
// Step definition (within runbook version JSON)
// ---------------------------------------------------------------------------

export const runbookVerificationDefinitionSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      steps: z.array(runbookStepDefinitionSchema).min(1).max(10),
      delaySeconds: z.number().int().min(0).max(300).optional(),
    })
    .strict()
);

export const runbookPrecheckDefinitionSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      steps: z.array(runbookStepDefinitionSchema).min(1).max(10),
    })
    .strict()
);

export const runbookStepDefinitionSchema = z
  .object({
    key: stepKeySchema,
    name: z.string().trim().min(1).max(200),
    type: z.enum(RUNBOOK_STEP_TYPES),
    riskClass: z.enum(RUNBOOK_RISK_CLASSES).default('READ_ONLY'),
    description: z.string().trim().max(2000).optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    verification: runbookVerificationDefinitionSchema.optional(),
    precheck: runbookPrecheckDefinitionSchema.optional(),
    timeoutSeconds: z.number().int().min(1).max(86400).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    requiresApproval: z.boolean().optional(),
  })
  .strict();

export type RunbookStepDefinitionInput = z.infer<typeof runbookStepDefinitionSchema>;

// ---------------------------------------------------------------------------
// Full runbook definition (stored as RunbookVersion.definition)
// ---------------------------------------------------------------------------

export const runbookDefinitionSchema = z
  .object({
    steps: z
      .array(runbookStepDefinitionSchema)
      .min(1, 'At least one step is required')
      .max(MAX_RUNBOOK_STEPS, `Maximum ${MAX_RUNBOOK_STEPS} steps allowed`),
    description: z.string().trim().max(5000).optional(),
    defaultTimeoutSeconds: z.number().int().min(1).max(86400).optional(),
    defaultMaxRetries: z.number().int().min(0).max(10).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Validate unique step keys
    const keys = new Set<string>();
    for (let i = 0; i < data.steps.length; i++) {
      const step = data.steps[i]!;
      if (keys.has(step.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate step key: "${step.key}"`,
          path: ['steps', i, 'key'],
        });
      }
      keys.add(step.key);
    }
  });

export type RunbookDefinitionInput = z.infer<typeof runbookDefinitionSchema>;

// ---------------------------------------------------------------------------
// Runbook CRUD
// ---------------------------------------------------------------------------

export const createRunbookSchema = z.object({
  name: runbookNameSchema,
  slug: runbookSlugSchema,
  description: runbookDescriptionSchema,
});

export type CreateRunbookInput = z.infer<typeof createRunbookSchema>;

export const updateRunbookSchema = z.object({
  name: runbookNameSchema.optional(),
  slug: runbookSlugSchema.optional(),
  description: runbookDescriptionSchema.optional(),
});

export type UpdateRunbookInput = z.infer<typeof updateRunbookSchema>;

// ---------------------------------------------------------------------------
// Runbook version
// ---------------------------------------------------------------------------

export const createRunbookVersionSchema = z.object({
  definition: runbookDefinitionSchema,
});

export type CreateRunbookVersionInput = z.infer<typeof createRunbookVersionSchema>;

export const updateRunbookVersionSchema = z.object({
  definition: runbookDefinitionSchema,
});

export type UpdateRunbookVersionInput = z.infer<typeof updateRunbookVersionSchema>;

// ---------------------------------------------------------------------------
// Runbook inputs
// ---------------------------------------------------------------------------

export const runbookInputSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_]+$/, 'Input key must be lowercase alphanumeric with underscores'),
    label: z.string().trim().min(1).max(200),
    type: z.enum(RUNBOOK_INPUT_TYPES).default('STRING'),
    required: z.boolean().default(false),
    defaultValue: z.string().max(2000).optional(),
    description: z.string().trim().max(1000).default(''),
    sequence: z.number().int().min(0).default(0),
  })
  .strict();

export type RunbookInputInput = z.infer<typeof runbookInputSchema>;

export const runbookInputsSchema = z
  .array(runbookInputSchema)
  .max(MAX_RUNBOOK_INPUTS)
  .superRefine((inputs, ctx) => {
    const keys = new Set<string>();
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!;
      if (keys.has(input.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate input key: "${input.key}"`,
          path: [i, 'key'],
        });
      }
      keys.add(input.key);
    }
  });

// ---------------------------------------------------------------------------
// Service runbook binding
// ---------------------------------------------------------------------------

export const createServiceRunbookBindingSchema = z
  .object({
    runbookId: z.string().cuid(),
    runbookVersionId: z.string().cuid().optional(),
    enabled: z.boolean().default(true),
    mode: z.enum(RUNBOOK_BINDING_MODES).default('MANUAL'),
    versionStrategy: z.enum(RUNBOOK_VERSION_STRATEGIES).default('LATEST_PUBLISHED'),
    defaultAgentPoolId: z.string().cuid().optional(),
    defaultAgentId: z.string().cuid().optional(),
    inputValues: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((data, ctx) => {
    // If mode is AUTOMATIC and version strategy is LATEST_PUBLISHED, warn
    // (validation only; the spec says automatic should prefer PINNED)
    if (data.mode === 'AUTOMATIC' && data.versionStrategy === 'LATEST_PUBLISHED') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Automatic execution mode should use PINNED version strategy to prevent unintended behavior changes.',
        path: ['versionStrategy'],
      });
    }
    // Pinned strategy requires a specific version ID
    if (data.versionStrategy === 'PINNED' && !data.runbookVersionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A specific runbook version must be selected when using PINNED version strategy.',
        path: ['runbookVersionId'],
      });
    }
  });

export type CreateServiceRunbookBindingInput = z.infer<typeof createServiceRunbookBindingSchema>;

export const updateServiceRunbookBindingSchema = z
  .object({
    runbookVersionId: z.string().cuid().optional().nullable(),
    enabled: z.boolean().optional(),
    mode: z.enum(RUNBOOK_BINDING_MODES).optional(),
    versionStrategy: z.enum(RUNBOOK_VERSION_STRATEGIES).optional(),
    defaultAgentPoolId: z.string().cuid().optional().nullable(),
    defaultAgentId: z.string().cuid().optional().nullable(),
    inputValues: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type UpdateServiceRunbookBindingInput = z.infer<typeof updateServiceRunbookBindingSchema>;

// ---------------------------------------------------------------------------
// Trigger configuration
// ---------------------------------------------------------------------------

export const runbookTriggerConditionSchema = z
  .object({
    field: z.string().trim().min(1).max(100),
    operator: z.enum(RUNBOOK_CONDITION_OPERATORS),
    value: z.unknown(),
    sequence: z.number().int().min(0).default(0),
  })
  .strict();

export type RunbookTriggerConditionInput = z.infer<typeof runbookTriggerConditionSchema>;

export const createRunbookTriggerSchema = z
  .object({
    // INCIDENT_CREATED is the only event currently wired to durable runtime
    // evaluation. Keep future enum values out of the public write contract
    // until their producers are implemented.
    event: z.literal('INCIDENT_CREATED'),
    conditionLogic: z.enum(RUNBOOK_CONDITION_LOGICS).default('AND'),
    enabled: z.boolean().default(true),
    conditions: z.array(runbookTriggerConditionSchema).max(20).default([]),
  })
  .strict();

export type CreateRunbookTriggerInput = z.infer<typeof createRunbookTriggerSchema>;

// ---------------------------------------------------------------------------
// Execution requests
// ---------------------------------------------------------------------------

export const startRunbookExecutionSchema = z
  .object({
    runbookId: z.string().cuid(),
    runbookVersionId: z.string().cuid().optional(),
    incidentId: z.string().cuid().optional(),
    serviceId: z.string().cuid().optional(),
    bindingId: z.string().cuid().optional(),
    inputValues: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type StartRunbookExecutionInput = z.infer<typeof startRunbookExecutionSchema>;

export const approveRunbookStepSchema = z
  .object({
    executionId: z.string().cuid(),
    stepId: z.string().cuid(),
    planDigest: z.string().min(1).max(128),
  })
  .strict();

export type ApproveRunbookStepInput = z.infer<typeof approveRunbookStepSchema>;

export const cancelRunbookExecutionSchema = z
  .object({
    executionId: z.string().cuid(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type CancelRunbookExecutionInput = z.infer<typeof cancelRunbookExecutionSchema>;

// ---------------------------------------------------------------------------
// Agent schemas
// ---------------------------------------------------------------------------

export const createRunbookAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    hostname: z.string().trim().max(255).optional(),
  })
  .strict();

export type CreateRunbookAgentInput = z.infer<typeof createRunbookAgentSchema>;

export const createRunbookAgentPoolSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).default(''),
    mode: z.enum(['LOCAL_HOSTS', 'SHARED_TARGET'] as const).default('SHARED_TARGET'),
    matchLabels: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export type CreateRunbookAgentPoolInput = z.infer<typeof createRunbookAgentPoolSchema>;

// ---------------------------------------------------------------------------
// Secret schemas
// ---------------------------------------------------------------------------

export const createRunbookSecretSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Secret name must be lowercase alphanumeric with hyphens'
      ),
    value: z.string().min(1).max(65536),
    description: z.string().trim().max(1000).default(''),
  })
  .strict();

export type CreateRunbookSecretInput = z.infer<typeof createRunbookSecretSchema>;

export const updateRunbookSecretSchema = z
  .object({
    value: z.string().min(1).max(65536).optional(),
    description: z.string().trim().max(1000).optional(),
  })
  .strict();

export type UpdateRunbookSecretInput = z.infer<typeof updateRunbookSecretSchema>;

// ---------------------------------------------------------------------------
// Agent result submission (from Agent API)
// ---------------------------------------------------------------------------

export const agentJobResultSchema = z
  .object({
    attemptId: z.string().cuid(),
    leaseToken: z.string().min(1),
    status: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'] as const),
    exitCode: z.number().int().optional(),
    outputPreview: z.string().max(32768).optional(),
    outputArtifactId: z.string().optional(),
    errorCode: z.string().max(100).optional(),
    errorMessage: z.string().max(5000).optional(),
    preState: z.record(z.string(), z.unknown()).optional(),
    postState: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type AgentJobResultInput = z.infer<typeof agentJobResultSchema>;

export const agentArtifactSchema = z
  .object({
    attemptId: z.string().cuid(),
    leaseToken: z.string().min(1).max(512),
    kind: z.enum(['OUTPUT', 'DIAGNOSTIC']).default('OUTPUT'),
    mediaType: z.string().trim().min(1).max(100).default('text/plain'),
    encoding: z.literal('gzip').default('gzip'),
    contentBase64: z.string().min(1).max(1_500_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    truncated: z.boolean().default(false),
  })
  .strict();

export type AgentArtifactInput = z.infer<typeof agentArtifactSchema>;

// ---------------------------------------------------------------------------
// Filter / query schemas
// ---------------------------------------------------------------------------

export const runbookExecutionFilterSchema = z.object({
  status: z
    .enum([
      'QUEUED',
      'RUNNING',
      'WAITING_AGENT',
      'WAITING_APPROVAL',
      'PAUSED',
      'SUCCEEDED',
      'FAILED',
      'CANCEL_REQUESTED',
      'CANCELLED',
      'TIMED_OUT',
    ] as const)
    .optional(),
  runbookId: z.string().cuid().optional(),
  incidentId: z.string().cuid().optional(),
  serviceId: z.string().cuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type RunbookExecutionFilter = z.infer<typeof runbookExecutionFilterSchema>;

export const runbookAgentFilterSchema = z.object({
  status: z.enum(['ENROLLING', 'ONLINE', 'DEGRADED', 'OFFLINE', 'REVOKED'] as const).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type RunbookAgentFilter = z.infer<typeof runbookAgentFilterSchema>;
