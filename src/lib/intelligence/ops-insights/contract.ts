import { z } from 'zod/v4';

/**
 * Shared contract of operations insights (Workstream J). Dependency-free apart from zod, so client components
 * can import the types and labels.
 *
 * An insight is something deterministic code noticed about one scope (a service, policy, schedule, runbook,
 * person or team), stored so that pages and badges only ever read rows. It suggests; a person acts through
 * the feature's own editor.
 */
export const OPS_INSIGHT_SCOPE_TYPES = [
  'SERVICE',
  'POLICY',
  'SCHEDULE',
  'RUNBOOK',
  'USER',
  'TEAM',
] as const;
export type OpsInsightScopeType = (typeof OPS_INSIGHT_SCOPE_TYPES)[number];

export interface OpsInsightScope {
  type: OpsInsightScopeType;
  id: string;
}

/** Lowest first, matching the database enum, so comparisons agree with `max("severity")`. */
export const OPS_INSIGHT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type OpsInsightSeverity = (typeof OPS_INSIGHT_SEVERITIES)[number];

export const OPS_INSIGHT_STATUSES = ['OPEN', 'ACCEPTED', 'DISMISSED', 'RESOLVED'] as const;
export type OpsInsightStatus = (typeof OPS_INSIGHT_STATUSES)[number];

/** One switch per area in IntelligenceSettings, all off by default, behind the master `opsInsightsEnabled`. */
export const OPS_INSIGHT_AREAS = {
  automation: {
    setting: 'opsInsightsAutomationEnabled',
    label: 'Service automation and integrations',
  },
  escalation: { setting: 'opsInsightsEscalationEnabled', label: 'Escalation policies' },
  onCall: { setting: 'opsInsightsOnCallEnabled', label: 'On-call schedules' },
  postmortems: { setting: 'opsInsightsPostmortemsEnabled', label: 'Postmortems' },
  runbooks: { setting: 'opsInsightsRunbooksEnabled', label: 'Runbooks' },
  notifications: { setting: 'opsInsightsNotificationsEnabled', label: 'Notifications' },
} as const;
export type OpsInsightArea = keyof typeof OPS_INSIGHT_AREAS;
export const OPS_INSIGHT_AREA_KEYS = Object.keys(OPS_INSIGHT_AREAS) as OpsInsightArea[];

export type OpsInsightSwitch =
  'opsInsightsEnabled' | (typeof OPS_INSIGHT_AREAS)[OpsInsightArea]['setting'];
export type OpsInsightSwitches = Record<OpsInsightSwitch, boolean>;
export const OPS_INSIGHT_SWITCHES: OpsInsightSwitch[] = [
  'opsInsightsEnabled',
  ...OPS_INSIGHT_AREA_KEYS.map(area => OPS_INSIGHT_AREAS[area].setting),
];

/** Areas whose insights are computed and shown. Empty while the master switch is off. */
export function enabledOpsInsightAreas(settings: OpsInsightSwitches): OpsInsightArea[] {
  if (!settings.opsInsightsEnabled) return [];
  return OPS_INSIGHT_AREA_KEYS.filter(area => settings[OPS_INSIGHT_AREAS[area].setting]);
}

export const OPS_INSIGHT_LIMITS = {
  keyLength: 200,
  titleLength: 140,
  summaryLength: 400,
  facts: 12,
  examples: 5,
  /** Serialized evidence above this is rejected: evidence is a short proof, not a data dump. */
  evidenceBytes: 4096,
  /** Insights one producer may emit for one scope; the rest are dropped, highest severity kept. */
  itemsPerKind: 25,
} as const;

const shortText = (max: number) => z.string().trim().min(1).max(max);
/** In-app path only: never a scheme, host or protocol-relative URL. */
const appPath = z
  .string()
  .max(300)
  .regex(/^\/(?![/\\])/);

/** What the evidence popover shows: the numbers behind the insight and a few examples to open. */
export const opsInsightEvidenceSchema = z
  .object({
    /** Plain-language window the facts cover, such as "last 7 days". */
    window: shortText(80).optional(),
    facts: z
      .array(z.object({ label: shortText(80), value: shortText(160) }).strict())
      .max(OPS_INSIGHT_LIMITS.facts),
    examples: z
      .array(z.object({ label: shortText(160), href: appPath.optional() }).strict())
      .max(OPS_INSIGHT_LIMITS.examples)
      .optional(),
  })
  .strict()
  .refine(value => JSON.stringify(value).length <= OPS_INSIGHT_LIMITS.evidenceBytes, {
    message: 'evidence is too large',
  });
export type OpsInsightEvidence = z.infer<typeof opsInsightEvidenceSchema>;

/** One insight as a producer emits it. `key` tells apart several insights of one kind on one scope. */
export const opsInsightItemSchema = z
  .object({
    key: z.string().max(OPS_INSIGHT_LIMITS.keyLength).default(''),
    severity: z.enum(OPS_INSIGHT_SEVERITIES),
    title: shortText(OPS_INSIGHT_LIMITS.titleLength),
    summary: shortText(OPS_INSIGHT_LIMITS.summaryLength),
    evidence: opsInsightEvidenceSchema,
    /** In-app path of the pre-filled editor or draft. Nothing is saved until a person saves it there. */
    draftHref: appPath.optional(),
  })
  .strict();
export type OpsInsightItem = z.input<typeof opsInsightItemSchema>;

export interface OpsInsightView {
  id: string;
  scopeType: OpsInsightScopeType;
  scopeId: string;
  kind: string;
  key: string;
  area: string;
  severity: OpsInsightSeverity;
  status: OpsInsightStatus;
  title: string;
  summary: string;
  evidence: OpsInsightEvidence;
  draftHref: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** An inbox row also names the thing it is about, so the list reads without opening anything. */
export interface OpsInsightInboxItem extends OpsInsightView {
  scopeName: string;
  scopeHref: string;
}

export interface OpsInsightCount {
  open: number;
  highest: OpsInsightSeverity;
}

export function severityRank(severity: OpsInsightSeverity): number {
  return OPS_INSIGHT_SEVERITIES.indexOf(severity);
}

export function highestSeverity(severities: readonly OpsInsightSeverity[]): OpsInsightSeverity {
  return severities.reduce<OpsInsightSeverity>(
    (top, next) => (severityRank(next) > severityRank(top) ? next : top),
    'INFO'
  );
}

export const OPS_INSIGHT_DECISIONS = ['accept', 'dismiss', 'reopen'] as const;
export type OpsInsightDecision = (typeof OPS_INSIGHT_DECISIONS)[number];
