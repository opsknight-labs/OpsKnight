import type { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import type { BurnState } from './slo';

/**
 * Catalog completeness scored against a rubric: rules over fields, custom attributes, SLO state and
 * hygiene flags, grouped into levels (Bronze, Silver, Gold). Pure, no I/O. The default rubric is the
 * seven original checks, so scores are unchanged until an administrator edits it.
 */

export const REVIEW_MAX_AGE_DAYS = 180;
const DAY_MS = 86_400_000;

export const SCORECARD_FIELDS = [
  'owner',
  'tier',
  'members',
  'slo',
  'links',
  'description',
  'reviewed',
  'escalationPolicy',
  'contactChannel',
  'statusPageSummary',
] as const;
export const SCORECARD_HYGIENE_FLAGS = [
  'REVIEW_OVERDUE',
  'OWNER_INACTIVE',
  'TEAM_NO_ONCALL',
] as const;
const TIERS = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'] as const;
const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Use lower-case letters, digits, - and _.');
const MAX_RULES = 50;
const MAX_LEVELS = 5;

const checkSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('field'),
      field: z.enum(SCORECARD_FIELDS),
      /** Only for `reviewed`: how recent the last review must be. */
      maxAgeDays: z.number().int().min(1).max(730).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('attribute'),
      key: z.string().trim().min(1).max(64),
      /** Absent: the attribute must be set. Present: it must equal this value. */
      equals: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('slo'),
      /** OK: error budget healthy. NOT_BREACHED: healthy or at risk. A service without an SLO fails. */
      state: z.enum(['OK', 'NOT_BREACHED']),
    })
    .strict(),
  z
    .object({
      type: z.literal('hygiene'),
      /** Passes while this hygiene flag is not raised. */
      flag: z.enum(SCORECARD_HYGIENE_FLAGS),
    })
    .strict(),
]);

const ruleSchema = z
  .object({
    id: slug,
    label: z.string().trim().min(1).max(80),
    check: checkSchema,
    /** Level this rule belongs to; a level is reached when it and every lower level pass. */
    level: slug.optional(),
    /** Scope: the rule applies only to business services owned by these teams. */
    teamIds: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    /** Scope: the rule applies only to these tiers. */
    tiers: z.array(z.enum(TIERS)).max(4).optional(),
    /** Initiative deadline (UTC date); a failing rule after it is overdue. */
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Not a date.')
      .optional(),
  })
  .strict();

export const scorecardRubricSchema = z
  .object({
    /** Ordered lowest first, e.g. bronze, silver, gold. */
    levels: z
      .array(z.object({ id: slug, label: z.string().trim().min(1).max(40) }).strict())
      .max(MAX_LEVELS),
    rules: z.array(ruleSchema).min(1).max(MAX_RULES),
  })
  .strict()
  .superRefine((rubric, ctx) => {
    const unique = (ids: string[], path: string) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id))
          ctx.addIssue({ code: 'custom', path: [path], message: `Duplicate id "${id}".` });
        seen.add(id);
      }
    };
    unique(
      rubric.levels.map(level => level.id),
      'levels'
    );
    unique(
      rubric.rules.map(rule => rule.id),
      'rules'
    );
    const levels = new Set(rubric.levels.map(level => level.id));
    rubric.rules.forEach((rule, index) => {
      if (rule.level && !levels.has(rule.level))
        ctx.addIssue({
          code: 'custom',
          path: ['rules', index, 'level'],
          message: `Unknown level "${rule.level}".`,
        });
      if (rule.check.type === 'field' && rule.check.maxAgeDays && rule.check.field !== 'reviewed')
        ctx.addIssue({
          code: 'custom',
          path: ['rules', index, 'check'],
          message: 'maxAgeDays applies to reviewed only.',
        });
    });
  });

export type ScorecardRubric = z.infer<typeof scorecardRubricSchema>;
export type ScorecardRule = ScorecardRubric['rules'][number];

/** The seven original checks; their ids and labels are part of the public scorecard. */
export const DEFAULT_SCORECARD_RUBRIC: ScorecardRubric = {
  levels: [
    { id: 'bronze', label: 'Bronze' },
    { id: 'silver', label: 'Silver' },
    { id: 'gold', label: 'Gold' },
  ],
  rules: [
    {
      id: 'owner',
      label: 'Has an owner',
      check: { type: 'field', field: 'owner' },
      level: 'bronze',
    },
    { id: 'tier', label: 'Has a tier', check: { type: 'field', field: 'tier' }, level: 'bronze' },
    {
      id: 'members',
      label: 'Has member services',
      check: { type: 'field', field: 'members' },
      level: 'bronze',
    },
    {
      id: 'slo',
      label: 'Has an SLO target',
      check: { type: 'field', field: 'slo' },
      level: 'silver',
    },
    {
      id: 'runbook',
      label: 'Has a runbook or links',
      check: { type: 'field', field: 'links' },
      level: 'silver',
    },
    {
      id: 'reviewed',
      label: `Reviewed in the last ${REVIEW_MAX_AGE_DAYS} days`,
      check: { type: 'field', field: 'reviewed', maxAgeDays: REVIEW_MAX_AGE_DAYS },
      level: 'gold',
    },
    {
      id: 'description',
      label: 'Has a description',
      check: { type: 'field', field: 'description' },
      level: 'silver',
    },
  ],
};

export type ScorecardInput = {
  ownerTeamId: string | null;
  ownerUserId?: string | null;
  criticality: string | null;
  memberCount: number;
  sloTarget?: number | null;
  linkCount: number;
  description: string | null;
  lastReviewedAt?: Date | null;
  escalationPolicyId?: string | null;
  contactChannel?: string | null;
  statusPageSummary?: string | null;
  customAttributes?: Record<string, unknown> | null;
  /** Burn state of the error budget; null without an SLO; undefined when not loaded (SLO rules skipped). */
  sloState?: BurnState | null;
  /** Raised hygiene flags; undefined when not loaded (hygiene rules skipped). */
  hygiene?: readonly string[];
};

export type ScorecardCheck = {
  id: string;
  label: string;
  passed: boolean;
  level: string | null;
  deadline: string | null;
  /** Failing after its initiative deadline. */
  overdue: boolean;
};

export type Scorecard = {
  /** The rules that apply to this service (scope and loaded inputs), in rubric order. */
  checks: ScorecardCheck[];
  /** Percent of applicable checks passed, 0 to 100. */
  score: number;
  /** Highest level reached; null when the rubric has no levels or the first is not met. */
  level: { id: string; label: string } | null;
  /** Structural basics, independent of the rubric: they drive the catalog `?needs=` filter. */
  basics: { owner: boolean; tier: boolean; members: boolean };
  needsAttention: boolean;
};

const filled = (value: string | null | undefined) => Boolean(value?.trim());

function passes(rule: ScorecardRule, input: ScorecardInput, now: Date): boolean | null {
  const check = rule.check;
  switch (check.type) {
    case 'field':
      switch (check.field) {
        case 'owner':
          return Boolean(input.ownerTeamId || input.ownerUserId);
        case 'tier':
          return Boolean(input.criticality);
        case 'members':
          return input.memberCount > 0;
        case 'slo':
          return input.sloTarget != null;
        case 'links':
          return input.linkCount > 0;
        case 'description':
          return filled(input.description);
        case 'reviewed': {
          const at = input.lastReviewedAt?.getTime();
          const maxAge = (check.maxAgeDays ?? REVIEW_MAX_AGE_DAYS) * DAY_MS;
          return at !== undefined && now.getTime() - at <= maxAge;
        }
        case 'escalationPolicy':
          return Boolean(input.escalationPolicyId);
        case 'contactChannel':
          return filled(input.contactChannel);
        case 'statusPageSummary':
          return filled(input.statusPageSummary);
      }
      return false;
    case 'attribute': {
      const value = new Map(Object.entries(input.customAttributes ?? {})).get(check.key);
      if (check.equals === undefined) return value !== undefined && value !== null && value !== '';
      return value === check.equals;
    }
    case 'slo':
      if (input.sloState === undefined) return null;
      return (
        input.sloState === 'OK' || (check.state === 'NOT_BREACHED' && input.sloState === 'AT_RISK')
      );
    case 'hygiene':
      return input.hygiene === undefined ? null : !input.hygiene.includes(check.flag);
  }
}

function inScope(rule: ScorecardRule, input: ScorecardInput) {
  if (rule.teamIds?.length && !(input.ownerTeamId && rule.teamIds.includes(input.ownerTeamId)))
    return false;
  if (rule.tiers?.length && !rule.tiers.includes(input.criticality as (typeof TIERS)[number]))
    return false;
  return true;
}

export function scoreBusinessService(
  input: ScorecardInput,
  now = new Date(),
  rubric: ScorecardRubric = DEFAULT_SCORECARD_RUBRIC
): Scorecard {
  const checks: ScorecardCheck[] = rubric.rules.flatMap(rule => {
    if (!inScope(rule, input)) return [];
    const passed = passes(rule, input, now);
    if (passed === null) return [];
    const deadline = rule.deadline ?? null;
    return [
      {
        id: rule.id,
        label: rule.label,
        passed,
        level: rule.level ?? null,
        deadline,
        overdue:
          !passed &&
          deadline !== null &&
          now.getTime() >= Date.parse(`${deadline}T00:00:00Z`) + DAY_MS,
      },
    ];
  });
  let level: Scorecard['level'] = null;
  for (const candidate of rubric.levels) {
    if (checks.some(check => check.level === candidate.id && !check.passed)) break;
    level = candidate;
  }
  const basics = {
    owner: Boolean(input.ownerTeamId || input.ownerUserId),
    tier: Boolean(input.criticality),
    members: input.memberCount > 0,
  };
  const passed = checks.filter(check => check.passed).length;
  return {
    checks,
    score: checks.length ? Math.round((passed / checks.length) * 100) : 100,
    level,
    basics,
    // The structural basics drive the catalog "needs attention" strip, not SLO or review hygiene.
    needsAttention: !basics.owner || !basics.tier || !basics.members,
  };
}

export const CATALOG_NEEDS = ['attention', 'no-owner', 'no-tier', 'no-members'] as const;
export type CatalogNeed = (typeof CATALOG_NEEDS)[number];

/** The same needs as a database filter, so the catalog can page and filter in SQL. */
export function needsWhere(need: CatalogNeed): Prisma.BusinessServiceWhereInput {
  const noOwner = { ownerTeamId: null, ownerUserId: null };
  const noTier = { criticality: null };
  const noMembers = { members: { none: {} } };
  if (need === 'no-owner') return noOwner;
  if (need === 'no-tier') return noTier;
  if (need === 'no-members') return noMembers;
  return { OR: [noOwner, noTier, noMembers] };
}

/** Whether a scored service matches the catalog `?needs=` filter. */
export function matchesNeed(card: Scorecard, need: CatalogNeed): boolean {
  if (need === 'attention') return card.needsAttention;
  return !card.basics[need === 'no-owner' ? 'owner' : need === 'no-tier' ? 'tier' : 'members'];
}

/** Whether evaluating the rubric needs the SLO burn state or hygiene flags loaded. */
export const rubricNeeds = (rubric: ScorecardRubric) => ({
  sloState: rubric.rules.some(rule => rule.check.type === 'slo'),
  hygiene: rubric.rules.some(rule => rule.check.type === 'hygiene'),
});
