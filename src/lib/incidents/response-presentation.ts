import { z } from 'zod';
import { verificationResultSchema } from '@/lib/runbooks/evidence';

/**
 * Client-safe presentation vocabulary shared by the incident response timeline,
 * the incident timeline and the incident Runbooks tab. Contains no data access.
 */

export const RESPONSE_LANES = [
  'ROUTING',
  'PAGING',
  'REMEDIATION',
  'VERIFICATION',
  'RECOVERY',
] as const;
export type ResponseLane = (typeof RESPONSE_LANES)[number];

/** Semantic tones mapped to the design-system status colors. */
export type ResponseTone = 'critical' | 'warning' | 'success' | 'info' | 'oncall' | 'neutral';

const LANE_PRESENTATION = new Map<ResponseLane, { label: string; tone: ResponseTone }>([
  ['ROUTING', { label: 'Routing', tone: 'info' }],
  ['PAGING', { label: 'Paging', tone: 'oncall' }],
  ['REMEDIATION', { label: 'Remediation', tone: 'warning' }],
  ['VERIFICATION', { label: 'Verification', tone: 'info' }],
  ['RECOVERY', { label: 'Recovery', tone: 'success' }],
]);

export function responseLaneLabel(lane: ResponseLane): string {
  return LANE_PRESENTATION.get(lane)?.label ?? lane;
}

export function responseLaneTone(lane: ResponseLane): ResponseTone {
  return LANE_PRESENTATION.get(lane)?.tone ?? 'neutral';
}

export const RUNBOOK_EVENT_TYPES = [
  'RUNBOOK_SUGGESTED',
  'RUNBOOK_STARTED',
  'RUNBOOK_STEP_COMPLETED',
  'RUNBOOK_APPROVAL_REQUIRED',
  'RUNBOOK_APPROVED',
  'RUNBOOK_COMPLETED',
  'RUNBOOK_FAILED',
  'RUNBOOK_CANCELLED',
  'RUNBOOK_SKIPPED',
  'RUNBOOK_VERIFIED',
  'RUNBOOK_UNVERIFIED',
] as const;
export type RunbookEventType = (typeof RUNBOOK_EVENT_TYPES)[number];

export function isRunbookEventType(type: string | null | undefined): type is RunbookEventType {
  return !!type && (RUNBOOK_EVENT_TYPES as readonly string[]).includes(type);
}

/** Message prefixes written by runbook recovery; IncidentEvent carries no structured metadata. */
export const HUMAN_INTERVENTION_PREFIX = 'Human intervention required';
export const RESOLUTION_RECOMMENDED_PREFIX = 'Resolution recommended';

export type RunbookEventSignal = 'HUMAN_INTERVENTION' | 'RESOLUTION_RECOMMENDED' | null;

export function runbookEventSignal(
  type: string | null | undefined,
  message: string
): RunbookEventSignal {
  if (type === 'RUNBOOK_UNVERIFIED' && message.startsWith(HUMAN_INTERVENTION_PREFIX))
    return 'HUMAN_INTERVENTION';
  if (type === 'RUNBOOK_VERIFIED' && message.includes(`${RESOLUTION_RECOMMENDED_PREFIX}:`))
    return 'RESOLUTION_RECOMMENDED';
  return null;
}

/** Event label/tone refined by the recovery signal carried in the message. */
export function runbookEventDisplay(
  type: RunbookEventType,
  message: string
): { label: string; tone: ResponseTone } {
  const signal = runbookEventSignal(type, message);
  if (signal === 'HUMAN_INTERVENTION')
    return { label: 'Human intervention required', tone: 'critical' };
  if (signal === 'RESOLUTION_RECOMMENDED')
    return { label: 'Recovery verified · resolution recommended', tone: 'success' };
  return runbookEventPresentation(type);
}

const RUNBOOK_EVENT_PRESENTATION = new Map<RunbookEventType, { label: string; tone: ResponseTone }>(
  [
    ['RUNBOOK_SUGGESTED', { label: 'Runbook suggested', tone: 'info' }],
    ['RUNBOOK_STARTED', { label: 'Runbook started', tone: 'info' }],
    ['RUNBOOK_STEP_COMPLETED', { label: 'Runbook step', tone: 'neutral' }],
    ['RUNBOOK_APPROVAL_REQUIRED', { label: 'Approval required', tone: 'warning' }],
    ['RUNBOOK_APPROVED', { label: 'Runbook step approved', tone: 'info' }],
    ['RUNBOOK_COMPLETED', { label: 'Runbook completed', tone: 'success' }],
    ['RUNBOOK_FAILED', { label: 'Runbook failed', tone: 'critical' }],
    ['RUNBOOK_CANCELLED', { label: 'Runbook cancelled', tone: 'neutral' }],
    ['RUNBOOK_SKIPPED', { label: 'Runbook skipped', tone: 'warning' }],
    ['RUNBOOK_VERIFIED', { label: 'Recovery verified', tone: 'success' }],
    ['RUNBOOK_UNVERIFIED', { label: 'Recovery not verified', tone: 'warning' }],
  ]
);

export function runbookEventPresentation(type: RunbookEventType): {
  label: string;
  tone: ResponseTone;
} {
  return RUNBOOK_EVENT_PRESENTATION.get(type) ?? { label: 'Runbook event', tone: 'neutral' };
}

export const RECOVERY_OUTCOMES = [
  'NOT_REQUESTED',
  'PENDING',
  'RESOLVED',
  'NOT_VERIFIED',
  'ALREADY_CLOSED',
  'BLOCKED',
] as const;
export type RecoveryOutcome = (typeof RECOVERY_OUTCOMES)[number];

type RecoveryOutcomePresentation = { label: string; description: string; tone: ResponseTone };
const RECOVERY_OUTCOME_PRESENTATION: Record<RecoveryOutcome, RecoveryOutcomePresentation> = {
  NOT_REQUESTED: {
    label: 'Resolution not requested',
    description:
      'Automatic resolution was not requested: the runbook made no writes or its binding does not resolve on verified recovery. Responders decide when to resolve.',
    tone: 'neutral',
  },
  PENDING: {
    label: 'Resolution pending',
    description:
      'Every write action was verified; resolution through the incident lifecycle is queued. Paging is unchanged until it applies.',
    tone: 'info',
  },
  RESOLVED: {
    label: 'Resolved after verified recovery',
    description:
      'The incident was resolved by the system lifecycle command because every write action was verified. Pending escalation was cancelled.',
    tone: 'success',
  },
  NOT_VERIFIED: {
    label: 'Recovery not verified',
    description:
      'Not every write action was verified, so the incident stays open and escalation continues. A successful command alone is not verification.',
    tone: 'warning',
  },
  ALREADY_CLOSED: {
    label: 'Incident already closed',
    description: 'The incident was already resolved when recovery was checked.',
    tone: 'neutral',
  },
  BLOCKED: {
    label: 'Automatic resolution blocked',
    description:
      'Recovery was verified, but the incident could not be resolved automatically. Escalation continues.',
    tone: 'critical',
  },
};

export function parseRecoveryOutcome(value: string | null | undefined): RecoveryOutcome | null {
  return value && (RECOVERY_OUTCOMES as readonly string[]).includes(value)
    ? (value as RecoveryOutcome)
    : null;
}

const RECOVERY_OUTCOME_MAP = new Map(
  Object.entries(RECOVERY_OUTCOME_PRESENTATION) as Array<
    [RecoveryOutcome, RecoveryOutcomePresentation]
  >
);

export function recoveryOutcomePresentation(outcome: RecoveryOutcome): RecoveryOutcomePresentation {
  return RECOVERY_OUTCOME_MAP.get(outcome) ?? RECOVERY_OUTCOME_PRESENTATION.NOT_REQUESTED;
}

const RESOLUTION_KIND_LABEL = new Map<string, string>([
  ['MANUAL', 'Manual'],
  ['SOURCE_RECOVERY', 'Source recovery'],
  ['AUTOMATION', 'Automation'],
  ['AUTO_TIMEOUT', 'Auto timeout'],
  ['UNKNOWN', 'Unknown'],
]);

export function resolutionKindLabel(kind: string): string {
  return RESOLUTION_KIND_LABEL.get(kind) ?? kind;
}

export type IncidentContextUnavailableReason =
  | 'NO_LIVE_DECISION'
  | 'FALLBACK'
  | 'NOT_CAPTURED'
  | 'INTEGRITY_FAILED';

const CONTEXT_REASON_LABEL = new Map<IncidentContextUnavailableReason, string>([
  ['NO_LIVE_DECISION', 'No live automation decision'],
  ['FALLBACK', 'Automation fell back to service defaults'],
  ['NOT_CAPTURED', 'Context was not captured'],
  ['INTEGRITY_FAILED', 'Context failed its integrity check'],
]);

export function incidentContextReasonLabel(reason: IncidentContextUnavailableReason): string {
  return CONTEXT_REASON_LABEL.get(reason) ?? 'Context unavailable';
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Bounds display strings and strips control characters; React escapes the rest. */
export function clipText(value: string, max = 240): string {
  const clean = value.replace(CONTROL_CHARS, '');
  const chars = [...clean];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : clean;
}

const CONTEXT_TEMPLATE = /\$\{\{\s*context\.([a-z][a-z0-9_]{0,63})\s*\}\}/g;
const ANY_TEMPLATE = /\$\{\{[^}]*\}\}/;

const stringRecord = z.record(z.string().max(256), z.string().max(1024));
const targetSelectionSchema = z
  .object({
    selector: stringRecord.optional().catch(undefined),
    resolvedLabels: stringRecord.optional().catch(undefined),
    resolvedSelector: stringRecord.optional().catch(undefined),
    contextKeys: z.array(z.string().max(64)).max(64).optional().catch(undefined),
    poolId: z.string().nullable().optional().catch(undefined),
    sourcePoolId: z.string().nullable().optional().catch(undefined),
    selectedAgentId: z.string().nullable().optional().catch(undefined),
    implicitLocalHost: z.boolean().optional().catch(undefined),
  })
  .passthrough();

export type ExecutionTargetLabel = {
  key: string;
  /** null when the value is derived from protected incident content and the viewer may not see it. */
  value: string | null;
  fromContext: boolean;
};

export type ExecutionTargetSummary = {
  labels: ExecutionTargetLabel[];
  contextKeys: string[];
  poolId: string | null;
  implicitLocalHost: boolean;
};

/**
 * Accepts both the legacy `{selector, resolvedSelector, sourcePoolId}` shape and the
 * context-targeting `{selector, resolvedLabels, contextKeys, poolId}` shape.
 */
export function summarizeExecutionTarget(
  targetSelection: unknown,
  canViewSensitive: boolean
): ExecutionTargetSummary {
  const parsed = targetSelectionSchema.safeParse(targetSelection ?? {});
  const data = parsed.success ? parsed.data : {};
  const selector = new Map(Object.entries(data.selector ?? {}));
  const resolved = new Map(Object.entries(data.resolvedLabels ?? data.resolvedSelector ?? {}));
  const contextKeys = new Set<string>(
    (data.contextKeys ?? []).filter(key => /^[a-z][a-z0-9_]{0,63}$/.test(key))
  );
  const labelKeys = [...new Set([...resolved.keys(), ...selector.keys()])].sort().slice(0, 32);
  const labels = labelKeys.map<ExecutionTargetLabel>(key => {
    const template = selector.get(key) ?? '';
    const fromContext = [...template.matchAll(CONTEXT_TEMPLATE)].length > 0;
    for (const match of template.matchAll(CONTEXT_TEMPLATE)) contextKeys.add(match[1]);
    const derived = ANY_TEMPLATE.test(template);
    const raw = resolved.get(key) ?? (derived ? null : template);
    return {
      key: clipText(key, 64),
      value: raw === null || (derived && !canViewSensitive) ? null : clipText(raw, 120),
      fromContext,
    };
  });
  return {
    labels,
    contextKeys: [...contextKeys].sort(),
    poolId: data.poolId ?? data.sourcePoolId ?? null,
    implicitLocalHost: data.implicitLocalHost === true,
  };
}

export type WriteVerificationState = 'NONE' | 'PENDING' | 'VERIFIED' | 'PARTIAL' | 'UNVERIFIED';

export type WriteActionVerification = {
  stepId: string;
  stepKey: string;
  name: string;
  riskClass: string;
  status: string;
  /** null when no verification result was recorded for this write action. */
  verified: boolean | null;
  reason: string | null;
  capturedAt: string | null;
};

export type ExecutionVerificationSummary = {
  state: WriteVerificationState;
  writeActions: WriteActionVerification[];
  verifiedCount: number;
  unverifiedCount: number;
  pendingCount: number;
};

export function summarizeExecutionVerification(
  steps: ReadonlyArray<{
    id: string;
    stepKey: string;
    name: string;
    riskClass: string;
    status: string;
    verificationResult: unknown;
  }>
): ExecutionVerificationSummary {
  const writeActions = steps
    .filter(step => step.riskClass !== 'READ_ONLY')
    .map<WriteActionVerification>(step => {
      const result = verificationResultSchema.safeParse(step.verificationResult);
      return {
        stepId: step.id,
        stepKey: step.stepKey,
        name: clipText(step.name, 120),
        riskClass: step.riskClass,
        status: step.status,
        verified: result.success ? result.data.verified : null,
        reason: result.success ? clipText(result.data.reason, 200) : null,
        capturedAt: result.success ? result.data.capturedAt : null,
      };
    });
  const verifiedCount = writeActions.filter(action => action.verified === true).length;
  const unverifiedCount = writeActions.filter(action => action.verified === false).length;
  const pendingCount = writeActions.length - verifiedCount - unverifiedCount;
  const state: WriteVerificationState = !writeActions.length
    ? 'NONE'
    : verifiedCount === writeActions.length
      ? 'VERIFIED'
      : unverifiedCount === writeActions.length
        ? 'UNVERIFIED'
        : verifiedCount === 0 && unverifiedCount === 0
          ? 'PENDING'
          : 'PARTIAL';
  return { state, writeActions, verifiedCount, unverifiedCount, pendingCount };
}

const VERIFICATION_STATE_PRESENTATION = new Map<
  WriteVerificationState,
  { label: string; tone: ResponseTone }
>([
  ['NONE', { label: 'No write actions', tone: 'neutral' }],
  ['PENDING', { label: 'Verification pending', tone: 'info' }],
  ['VERIFIED', { label: 'All write actions verified', tone: 'success' }],
  ['PARTIAL', { label: 'Some write actions unverified', tone: 'warning' }],
  ['UNVERIFIED', { label: 'Write actions unverified', tone: 'warning' }],
]);

export function verificationStatePresentation(state: WriteVerificationState): {
  label: string;
  tone: ResponseTone;
} {
  return VERIFICATION_STATE_PRESENTATION.get(state) ?? { label: state, tone: 'neutral' };
}

const TONE_CLASSES = new Map<ResponseTone, { chip: string; dot: string }>([
  [
    'critical',
    {
      chip: 'border-rose-600/40 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-200',
      dot: 'bg-rose-600',
    },
  ],
  [
    'warning',
    {
      chip: 'border-amber-600/40 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200',
      dot: 'bg-amber-500',
    },
  ],
  [
    'success',
    {
      chip: 'border-emerald-600/40 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200',
      dot: 'bg-emerald-600',
    },
  ],
  [
    'info',
    {
      chip: 'border-blue-600/40 bg-blue-50 text-blue-800 dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-200',
      dot: 'bg-blue-600',
    },
  ],
  [
    'oncall',
    {
      chip: 'border-violet-600/40 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-950/40 dark:text-violet-200',
      dot: 'bg-violet-600',
    },
  ],
  [
    'neutral',
    {
      chip: 'border-border bg-muted/40 text-muted-foreground dark:bg-muted/20 dark:text-muted-foreground',
      dot: 'bg-slate-400',
    },
  ],
]);

/** Semantic chip classes: critical red, warning amber, success green, info blue, on-call violet. */
export function toneChipClass(tone: ResponseTone): string {
  return TONE_CLASSES.get(tone)?.chip ?? '';
}

export function toneDotClass(tone: ResponseTone): string {
  return TONE_CLASSES.get(tone)?.dot ?? '';
}
