import { z } from 'zod/v4';
import type { IncidentUrgency } from '@prisma/client';

/**
 * Pre-paging noise controls: the shared, dependency-free contract. Validated at the edge (settings UI,
 * API) and compiled once into the in-process snapshot the ingestion hook reads. Nothing in this file
 * touches the database or the network, so client components may import it.
 */

export const NOISE_CONTROL_MODES = ['OFF', 'SHADOW', 'ON'] as const;
export type NoiseControlModeValue = (typeof NOISE_CONTROL_MODES)[number];

export const PREPAGING_LIMITS = {
  /** The whole evaluation, lookups included, must finish inside this or the event pages normally. */
  deadlineMs: 5,
  cacheRefreshMs: 30_000,
  maxMatchers: 16,
  maxOrchestrationRules: 50,
  maxConditions: 10,
  maxActions: 6,
  regexLength: 200,
  textLength: 2_000,
  maxHoldSeconds: 60,
  maxWindowDays: 7,
  maxRecurrenceCount: 10_000,
  storm: { minThreshold: 2, maxThreshold: 1_000, minWindowSeconds: 10, maxWindowSeconds: 3_600 },
  dedup: { minWindowSeconds: 60, maxWindowSeconds: 86_400 },
  flapping: { minWindowSeconds: 30, maxWindowSeconds: 3_600, minThreshold: 2, maxThreshold: 50 },
} as const;

export const GLOBAL_NOISE_SCOPE_KEY = 'global';
export const noiseScopeKey = (serviceId?: string | null) =>
  serviceId ? `service:${serviceId}` : GLOBAL_NOISE_SCOPE_KEY;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id');
const shortText = z.string().trim().min(1).max(120);
const longText = z.string().trim().max(500);
const urgency = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const labelKey = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_.:/-]+$/i, 'Label keys use letters, digits and . _ : / -');

/** Patterns that can blow up on long inputs are rejected at save time; the hook never compiles user text. */
export function assertSafeRegex(pattern: string): void {
  if (pattern.length === 0 || pattern.length > PREPAGING_LIMITS.regexLength)
    throw new Error('Pattern must be between 1 and 200 characters');
  if (/\\[1-9]/.test(pattern)) throw new Error('Back-references are not supported');
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern) || /[+*]\)?[+*]/.test(pattern))
    throw new Error('Nested or stacked quantifiers are not supported');
  try {
    // Validated once at save time, bounded in length and shape above; never compiled on the hot path.
    // eslint-disable-next-line security/detect-non-literal-regexp
    new RegExp(pattern, 'i');
  } catch {
    throw new Error('Pattern is not a valid regular expression');
  }
}

export const MATCHER_FIELDS = [
  'source',
  'summary',
  'severity',
  'resourceKey',
  'fingerprintHash',
  'dedupKey',
  'label',
] as const;
export type MatcherField = (typeof MATCHER_FIELDS)[number];
export const MATCHER_OPS = ['equals', 'contains', 'prefix', 'regex', 'exists'] as const;
export type MatcherOp = (typeof MATCHER_OPS)[number];

export const matcherSchema = z
  .object({
    field: z.enum(MATCHER_FIELDS),
    /** Label key; required when field is "label". */
    key: labelKey.optional(),
    op: z.enum(MATCHER_OPS),
    value: z.string().max(PREPAGING_LIMITS.textLength).optional(),
  })
  .strict()
  .superRefine((matcher, ctx) => {
    if (matcher.field === 'label' && !matcher.key)
      ctx.addIssue({ code: 'custom', path: ['key'], message: 'Label matchers need a key' });
    if (matcher.field !== 'label' && matcher.key)
      ctx.addIssue({ code: 'custom', path: ['key'], message: 'Only label matchers take a key' });
    if (matcher.op !== 'exists' && (matcher.value === undefined || matcher.value.length === 0))
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'A value is required' });
    if (matcher.op === 'regex' && matcher.value) {
      try {
        assertSafeRegex(matcher.value);
      } catch (error) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: (error as Error).message });
      }
    }
  });
export type Matcher = z.infer<typeof matcherSchema>;

export const orchestrationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DROP') }).strict(),
  z.object({ type: z.literal('SUPPRESS') }).strict(),
  z.object({ type: z.literal('SET_SEVERITY'), value: z.string().trim().min(1).max(32) }).strict(),
  z.object({ type: z.literal('SET_URGENCY'), value: urgency }).strict(),
  z
    .object({
      type: z.literal('SET_LABEL'),
      key: labelKey,
      value: z.string().trim().min(1).max(128),
    })
    .strict(),
  z.object({ type: z.literal('REROUTE_SERVICE'), serviceId: id }).strict(),
  z.object({ type: z.literal('ATTACH_RUNBOOK'), runbookId: id }).strict(),
  z.object({ type: z.literal('ADD_NOTE'), text: z.string().trim().min(1).max(500) }).strict(),
]);
export type OrchestrationAction = z.infer<typeof orchestrationActionSchema>;

export const orchestrationRuleSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Rule ids use lowercase letters, digits, "-" and "_"'),
    name: shortText,
    enabled: z.boolean().default(true),
    /** Every condition must match (AND); use several rules for OR. */
    conditions: z.array(matcherSchema).min(1).max(PREPAGING_LIMITS.maxConditions),
    actions: z.array(orchestrationActionSchema).min(1).max(PREPAGING_LIMITS.maxActions),
  })
  .strict();
export type OrchestrationRule = z.infer<typeof orchestrationRuleSchema>;

export const noiseControlDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    /**
     * HIGH urgency is the page-immediately class. Dedup, flapping and storm grouping leave it alone unless
     * a service opts in here; a hold is never applied to HIGH.
     */
    allowHighUrgency: z.boolean().default(false),
    contentDedup: z
      .object({
        enabled: z.boolean().default(false),
        windowSeconds: z
          .number()
          .int()
          .min(PREPAGING_LIMITS.dedup.minWindowSeconds)
          .max(PREPAGING_LIMITS.dedup.maxWindowSeconds)
          .default(900),
        /** The open incident's labels must contain the alert's labels (a subset), not only the same text. */
        requireLabelSubset: z.boolean().default(true),
      })
      .strict()
      .default({ enabled: false, windowSeconds: 900, requireLabelSubset: true }),
    flapping: z
      .object({
        enabled: z.boolean().default(false),
        windowSeconds: z
          .number()
          .int()
          .min(PREPAGING_LIMITS.flapping.minWindowSeconds)
          .max(PREPAGING_LIMITS.flapping.maxWindowSeconds)
          .default(180),
        threshold: z
          .number()
          .int()
          .min(PREPAGING_LIMITS.flapping.minThreshold)
          .max(PREPAGING_LIMITS.flapping.maxThreshold)
          .default(4),
        /** Also key on the content fingerprint, so retriggers under rotating dedup keys are caught. */
        keyOnFingerprint: z.boolean().default(true),
      })
      .strict()
      .default({ enabled: false, windowSeconds: 180, threshold: 4, keyOnFingerprint: true }),
    storm: z
      .object({
        enabled: z.boolean().default(false),
        threshold: z
          .number()
          .int()
          .min(PREPAGING_LIMITS.storm.minThreshold)
          .max(PREPAGING_LIMITS.storm.maxThreshold)
          .default(10),
        windowSeconds: z
          .number()
          .int()
          .min(PREPAGING_LIMITS.storm.minWindowSeconds)
          .max(PREPAGING_LIMITS.storm.maxWindowSeconds)
          .default(60),
        /** 0 means no hold: children attach to the parent immediately. Never applied to HIGH urgency. */
        holdSeconds: z.number().int().min(0).max(PREPAGING_LIMITS.maxHoldSeconds).default(0),
        /** Count incidents across the service's approved dependency neighbourhood, not only itself. */
        topology: z.boolean().default(false),
      })
      .strict()
      .default({
        enabled: false,
        threshold: 10,
        windowSeconds: 60,
        holdSeconds: 0,
        topology: false,
      }),
    orchestration: z
      .object({
        rules: z
          .array(orchestrationRuleSchema)
          .max(PREPAGING_LIMITS.maxOrchestrationRules)
          .default([]),
      })
      .strict()
      .default({ rules: [] }),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const seen = new Set<string>();
    definition.orchestration.rules.forEach((rule, index) => {
      if (seen.has(rule.id))
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate rule id "${rule.id}"`,
          path: ['orchestration', 'rules', index, 'id'],
        });
      seen.add(rule.id);
    });
  });
export type NoiseControlDefinition = z.infer<typeof noiseControlDefinitionSchema>;

export const DEFAULT_NOISE_CONTROL_DEFINITION: NoiseControlDefinition =
  noiseControlDefinitionSchema.parse({ schemaVersion: 1 });

export const noiseControlPolicyInputSchema = z
  .object({
    serviceId: id.nullable().optional(),
    mode: z.enum(NOISE_CONTROL_MODES),
    definition: noiseControlDefinitionSchema,
    /** 0 when creating; the saved revision otherwise. */
    expectedRevision: z.number().int().min(0),
    /** Operators may switch to ON without shadow evidence only by saying so explicitly. */
    acknowledgeReadiness: z.boolean().optional(),
  })
  .strict();
export type NoiseControlPolicyInput = z.infer<typeof noiseControlPolicyInputSchema>;

const isoDate = z.iso.datetime({ offset: true });

export const maintenanceWindowInputSchema = z
  .object({
    name: shortText,
    description: longText.optional(),
    scope: z.enum(['SERVICE', 'TEAM', 'LABEL', 'ALL']),
    serviceId: id.optional(),
    teamId: id.optional(),
    labelKey: labelKey.optional(),
    labelValue: z.string().trim().min(1).max(128).optional(),
    startsAt: isoDate,
    endsAt: isoDate,
    recurrence: z.string().trim().max(512).nullable().optional(),
    effect: z.enum(['SUPPRESS', 'DOWNGRADE']).default('SUPPRESS'),
    downgradeUrgency: urgency.optional(),
    statusPageAnnouncementId: id.optional(),
  })
  .strict()
  .superRefine((window, ctx) => {
    const duration = Date.parse(window.endsAt) - Date.parse(window.startsAt);
    if (!(duration > 0 && duration <= PREPAGING_LIMITS.maxWindowDays * 86_400_000))
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'A window lasts between one minute and seven days',
      });
    if (window.scope === 'SERVICE' && !window.serviceId)
      ctx.addIssue({ code: 'custom', path: ['serviceId'], message: 'Pick a service' });
    if (window.scope === 'TEAM' && !window.teamId)
      ctx.addIssue({ code: 'custom', path: ['teamId'], message: 'Pick a team' });
    if (window.scope === 'LABEL' && (!window.labelKey || !window.labelValue))
      ctx.addIssue({
        code: 'custom',
        path: ['labelKey'],
        message: 'Label windows need a key and value',
      });
    if (window.effect === 'DOWNGRADE' && !window.downgradeUrgency)
      ctx.addIssue({
        code: 'custom',
        path: ['downgradeUrgency'],
        message: 'Pick the urgency to downgrade to',
      });
  });
export type MaintenanceWindowInput = z.infer<typeof maintenanceWindowInputSchema>;

export const suppressionRuleInputSchema = z
  .object({
    name: shortText,
    description: longText.optional(),
    serviceId: id.nullable().optional(),
    matchers: z.array(matcherSchema).min(1).max(PREPAGING_LIMITS.maxMatchers),
    effect: z.enum(['SUPPRESS', 'DOWNGRADE']).default('SUPPRESS'),
    downgradeUrgency: urgency.optional(),
    expiresAt: isoDate.nullable().optional(),
    ownerId: id.nullable().optional(),
    origin: z.enum(['MANUAL', 'SUGGESTED']).default('MANUAL'),
    suggestion: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.effect === 'DOWNGRADE' && !rule.downgradeUrgency)
      ctx.addIssue({
        code: 'custom',
        path: ['downgradeUrgency'],
        message: 'Pick the urgency to downgrade to',
      });
  });
export type SuppressionRuleInput = z.infer<typeof suppressionRuleInputSchema>;

export const heartbeatMonitorInputSchema = z
  .object({
    name: shortText,
    description: longText.optional(),
    serviceId: id,
    intervalSeconds: z
      .number()
      .int()
      .min(10)
      .max(7 * 86_400),
    graceSeconds: z.number().int().min(0).max(86_400).default(60),
    urgency: urgency.default('MEDIUM'),
  })
  .strict();
export type HeartbeatMonitorInput = z.infer<typeof heartbeatMonitorInputSchema>;

/** What the ingestion hook knows about an alert before any incident exists. */
export interface PrePagingInput {
  serviceId: string;
  teamId?: string | null;
  source: string;
  summary: string;
  severity: string | null;
  urgency: IncidentUrgency;
  labels: Readonly<Record<string, string>>;
  resourceKey: string | null;
  fingerprintHash: string | null;
  dedupKey: string;
  receivedAt: Date;
}

export type PrePagingControlName =
  | 'MAINTENANCE'
  | 'SUPPRESSION'
  | 'ORCHESTRATION'
  | 'CONTENT_DEDUP'
  | 'FLAPPING'
  | 'STORM'
  | 'HEARTBEAT';

export type PrePagingActionName =
  'NONE' | 'SUPPRESS' | 'DOWNGRADE' | 'APPEND' | 'GROUP_CHILD' | 'HOLD' | 'DROP' | 'TRANSFORM';

export interface PrePagingTransform {
  severity?: string;
  urgency?: IncidentUrgency;
  labels?: Record<string, string>;
  serviceId?: string;
  runbookIds?: string[];
  notes?: string[];
}

export type PrePagingFailOpenReason = 'off' | 'cache_cold' | 'deadline' | 'error';

/**
 * The hook's answer. `apply` is false in SHADOW mode and whenever the hook failed open: the caller then
 * proceeds exactly as it does today. In ON mode `action` tells the caller what to do instead of paging.
 */
export interface PrePagingDecisionResult {
  mode: NoiseControlModeValue;
  apply: boolean;
  action: PrePagingActionName;
  control: PrePagingControlName | null;
  reason: string;
  sourceId: string | null;
  sourceName: string | null;
  /** APPEND / GROUP_CHILD: the open incident to attach the alert to. */
  targetIncidentId: string | null;
  /** DOWNGRADE: the urgency to page at instead. */
  urgency?: IncidentUrgency;
  /** HOLD: when the held alert must page if nothing else absorbs it. */
  holdUntil?: Date;
  transform?: PrePagingTransform;
  evidence: Record<string, unknown>;
  policyRevision: number | null;
  failOpen?: { reason: PrePagingFailOpenReason };
  elapsedMs: number;
}
