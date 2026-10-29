/**
 * OpsKnight Intelligence contract: constants, limits and validation schemas shared by the domain
 * services, REST v2, UI and (later) MCP. This module is dependency-free (no Prisma, no server-only)
 * so client components can import it. Configuration is DB-backed and UI-edited; nothing here reads
 * the process environment.
 */
import { z } from 'zod/v4';

/** Bumped whenever normalization, scoring or rule semantics change; stamped on every decision. */
export const INTELLIGENCE_ENGINE_VERSION = '1.1.0';

export const INTELLIGENCE_MODES = ['OFF', 'SHADOW', 'SUGGEST', 'AUTO'] as const;
export type IntelligenceModeValue = (typeof INTELLIGENCE_MODES)[number];

/**
 * AUTO changes production behaviour, so it stays unavailable until the shadow-quality, fault-tolerance
 * and ingestion-performance gates are certified (plan stage 3). Flipping this is a code change that
 * must ship together with its certification evidence, never a runtime setting.
 */
export const AUTO_MODE_AVAILABLE = false;

export const GLOBAL_POLICY_SCOPE_KEY = 'global';

export function servicePolicyScopeKey(serviceId: string): string {
  return `service:${serviceId}`;
}

/** Mirrors the CHECK constraint on "IntelligenceSettings"; the database is the final authority. */
export const INTELLIGENCE_SETTINGS_BOUNDS = {
  maxConcurrency: { min: 1, max: 16 },
  batchSize: { min: 1, max: 500 },
  maxJobMs: { min: 100, max: 120_000 },
  maxDbMs: { min: 50, max: 60_000 },
  candidateCap: { min: 1, max: 500 },
  lookbackDays: { min: 1, max: 3650 },
  backpressureEscalationLagMs: { min: 1000, max: 3_600_000 },
  retentionDays: { min: 1, max: 3650 },
} as const;

export const INTELLIGENCE_SETTINGS_DEFAULTS = {
  enabled: false,
  maxConcurrency: 2,
  batchSize: 20,
  maxJobMs: 5000,
  maxDbMs: 2000,
  candidateCap: 50,
  lookbackDays: 30,
  backpressureEscalationLagMs: 15_000,
  fingerprintRetentionDays: 730,
  correlationRetentionDays: 365,
  findingRetentionDays: 365,
  feedbackRetentionDays: 730,
} as const;

const bounded = (range: { min: number; max: number }) =>
  z.number().int().min(range.min).max(range.max);

export const intelligenceSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    maxConcurrency: bounded(INTELLIGENCE_SETTINGS_BOUNDS.maxConcurrency),
    batchSize: bounded(INTELLIGENCE_SETTINGS_BOUNDS.batchSize),
    maxJobMs: bounded(INTELLIGENCE_SETTINGS_BOUNDS.maxJobMs),
    maxDbMs: bounded(INTELLIGENCE_SETTINGS_BOUNDS.maxDbMs),
    candidateCap: bounded(INTELLIGENCE_SETTINGS_BOUNDS.candidateCap),
    lookbackDays: bounded(INTELLIGENCE_SETTINGS_BOUNDS.lookbackDays),
    backpressureEscalationLagMs: bounded(INTELLIGENCE_SETTINGS_BOUNDS.backpressureEscalationLagMs),
    fingerprintRetentionDays: bounded(INTELLIGENCE_SETTINGS_BOUNDS.retentionDays),
    correlationRetentionDays: bounded(INTELLIGENCE_SETTINGS_BOUNDS.retentionDays),
    findingRetentionDays: bounded(INTELLIGENCE_SETTINGS_BOUNDS.retentionDays),
    feedbackRetentionDays: bounded(INTELLIGENCE_SETTINGS_BOUNDS.retentionDays),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(value => value.maxDbMs <= value.maxJobMs, {
    message: 'maxDbMs cannot exceed maxJobMs',
    path: ['maxDbMs'],
  });
export type IntelligenceSettingsInput = z.infer<typeof intelligenceSettingsInputSchema>;

/**
 * Grouping rule kinds available to operators. Rules are deterministic and explainable. Learning
 * only proposes rules of these same kinds from people's link decisions; a person publishes them.
 */
export const CORRELATION_RULE_KINDS = ['EXACT_FIELD', 'CONTENT_TEMPLATE', 'LABEL_SET'] as const;
export type CorrelationRuleKind = (typeof CORRELATION_RULE_KINDS)[number];

export const MAX_CORRELATION_RULES_PER_POLICY = 25;
export const MIN_CORRELATION_WINDOW_SECONDS = 30;
export const MAX_CORRELATION_WINDOW_SECONDS = 24 * 60 * 60;

const ruleIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Rule ids use lowercase letters, digits, "-" and "_"');

export const correlationRuleSchema = z
  .object({
    id: ruleIdSchema,
    kind: z.enum(CORRELATION_RULE_KINDS),
    enabled: z.boolean().default(true),
    /** Field names (EXACT_FIELD) or label keys (LABEL_SET) that define the signature. */
    keys: z.array(z.string().min(1).max(128)).max(16).default([]),
    windowSeconds: z
      .number()
      .int()
      .min(MIN_CORRELATION_WINDOW_SECONDS)
      .max(MAX_CORRELATION_WINDOW_SECONDS),
    /** Hard ceiling on a sliding window so a group can never stay open forever. */
    maxWindowSeconds: z
      .number()
      .int()
      .min(MIN_CORRELATION_WINDOW_SECONDS)
      .max(MAX_CORRELATION_WINDOW_SECONDS),
    minScore: z.number().min(0).max(1).default(0.8),
  })
  .strict()
  .refine(rule => rule.maxWindowSeconds >= rule.windowSeconds, {
    message: 'maxWindowSeconds must be at least windowSeconds',
    path: ['maxWindowSeconds'],
  })
  .refine(rule => rule.kind === 'CONTENT_TEMPLATE' || rule.keys.length > 0, {
    message: 'EXACT_FIELD and LABEL_SET rules need at least one key',
    path: ['keys'],
  });
export type CorrelationRule = z.infer<typeof correlationRuleSchema>;

export const policyDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    similarity: z
      .object({
        enabled: z.boolean().default(true),
        minScore: z.number().min(0).max(1).default(0.35),
      })
      .strict()
      .default({ enabled: true, minScore: 0.35 }),
    correlation: z
      .object({
        rules: z.array(correlationRuleSchema).max(MAX_CORRELATION_RULES_PER_POLICY).default([]),
        /**
         * Critical/high-urgency alerts bypass grouping and any hold by default. Disabling this is
         * reserved for a later certified stage, so the schema only accepts true today.
         */
        criticalBypass: z.literal(true).default(true),
      })
      .strict()
      .default({ rules: [], criticalBypass: true }),
    /** Probable-cause and runbook-ranking findings. Recommendations only; nothing here ever acts. */
    response: z
      .object({
        enabled: z.boolean().default(true),
      })
      .strict()
      .default({ enabled: true }),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const seen = new Set<string>();
    definition.correlation.rules.forEach((rule, index) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate rule id "${rule.id}"`,
          path: ['correlation', 'rules', index, 'id'],
        });
      }
      seen.add(rule.id);
    });
  });
export type PolicyDefinition = z.infer<typeof policyDefinitionSchema>;

export const DEFAULT_POLICY_DEFINITION: PolicyDefinition = policyDefinitionSchema.parse({
  schemaVersion: 1,
});

export const publishPolicyInputSchema = z
  .object({
    mode: z.enum(INTELLIGENCE_MODES),
    definition: policyDefinitionSchema,
    reason: z.string().trim().min(1).max(500).optional(),
    expectedHeadVersion: z.number().int().nonnegative(),
  })
  .strict();
export type PublishPolicyInput = z.infer<typeof publishPolicyInputSchema>;

export const rollbackPolicyInputSchema = z
  .object({
    targetVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
    expectedHeadVersion: z.number().int().positive(),
  })
  .strict();
export type RollbackPolicyInput = z.infer<typeof rollbackPolicyInputSchema>;

/** Response-intelligence bounds. Hard caps keep every analysis O(small) regardless of data volume. */
export const RESPONSE_LIMITS = {
  /** How far before incident onset a change or upstream incident may sit to be considered. */
  causeLookbackMinutes: 360,
  /** Proximity decay constant: a change this many minutes before onset scores ~37% of an instant one. */
  proximityTauMinutes: 60,
  maxUpstreamDepth: 3,
  maxCauseCandidates: 25,
  maxCauseFindings: 5,
  maxRunbookFindings: 5,
  runbookHistoryDays: 180,
  /** Confidence never reaches certainty: a temporal correlation is a hypothesis to verify. */
  maxCauseConfidence: 0.9,
} as const;
