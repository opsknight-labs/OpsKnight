/**
 * Escalation policy domain validation.
 *
 * The engine treats a policy step as an instruction it must be able to execute
 * years after it was written. A step whose delay is `NaN`, whose target type
 * and target id disagree, or whose channel is not a channel the system can
 * deliver on, is not a configuration problem discovered at edit time — it is a
 * page that silently does not happen during an incident.
 *
 * Pure: no database, no clock. Reference existence is checked separately, since
 * that needs a transaction.
 */
import type { EscalationTargetType, Prisma } from '@prisma/client';
import { NOTIFICATION_CHANNELS, type NotificationDeliveryChannel } from '../notification-delivery';

/** A week. Long enough for any real policy, short enough to catch a typo. */
export const MAX_ESCALATION_DELAY_MINUTES = 7 * 24 * 60;

/**
 * Form marker meaning "this submission is authoritative for
 * `notificationChannels`".
 *
 * An absent multi-value field and a deliberately emptied one both arrive as
 * `[]`, so a partial edit cannot tell them apart on its own. A form that
 * renders channel controls submits this marker; one that does not omits both,
 * and the step keeps the channels it already had.
 */
export const ESCALATION_STEP_CHANNELS_SUBMITTED = 'notificationChannelsSubmitted';

export interface EscalationStepIssue {
  field: string;
  message: string;
}

export interface ValidatedEscalationStep {
  targetType: EscalationTargetType;
  targetUserId: string | null;
  targetTeamId: string | null;
  targetScheduleId: string | null;
  delayMinutes: number;
  notificationChannels: NotificationDeliveryChannel[];
  notifyOnlyTeamLead: boolean;
}

export type EscalationStepValidation =
  | { valid: true; step: ValidatedEscalationStep }
  | { valid: false; issues: EscalationStepIssue[] };

const TARGET_TYPES: readonly EscalationTargetType[] = ['USER', 'TEAM', 'SCHEDULE'];

/**
 * Parses a delay from form input.
 *
 * Returns null for anything that is not a whole number of minutes within
 * bounds. `parseInt('later')` is `NaN`, and a `NaN` delay reaches the database
 * as a step that can never come due.
 */
export function parseEscalationDelayMinutes(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return 0;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_ESCALATION_DELAY_MINUTES) return null;
  return value;
}

/** The target id a step of this type must carry, and only that one. */
export function targetIdFieldFor(targetType: EscalationTargetType): keyof ValidatedEscalationStep {
  if (targetType === 'TEAM') return 'targetTeamId';
  if (targetType === 'SCHEDULE') return 'targetScheduleId';
  return 'targetUserId';
}

export interface EscalationStepInput {
  targetType: unknown;
  targetUserId?: unknown;
  targetTeamId?: unknown;
  targetScheduleId?: unknown;
  delayMinutes?: unknown;
  notificationChannels?: unknown;
  notifyOnlyTeamLead?: unknown;
}

function trimmedId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validates one step and returns it in the exact shape the database expects,
 * with the two target ids that do not match the target type set to null.
 */
export function validateEscalationStep(input: EscalationStepInput): EscalationStepValidation {
  const issues: EscalationStepIssue[] = [];

  const targetType = TARGET_TYPES.find(candidate => candidate === input.targetType);
  if (!targetType) {
    return {
      valid: false,
      issues: [{ field: 'targetType', message: 'Choose a user, team, or schedule to page.' }],
    };
  }

  const delayMinutes = parseEscalationDelayMinutes(input.delayMinutes);
  if (delayMinutes === null) {
    issues.push({
      field: 'delayMinutes',
      message: `Delay must be a whole number of minutes between 0 and ${MAX_ESCALATION_DELAY_MINUTES}.`,
    });
  }

  // Only the id matching the target type is read. The other two are ignored
  // rather than carried through, so the stored row cannot disagree with itself.
  const requiredField = targetIdFieldFor(targetType);
  const targetId =
    targetType === 'TEAM'
      ? trimmedId(input.targetTeamId)
      : targetType === 'SCHEDULE'
        ? trimmedId(input.targetScheduleId)
        : trimmedId(input.targetUserId);

  if (!targetId) {
    issues.push({
      field: requiredField,
      message: `Select the ${targetType.toLowerCase()} this step should page.`,
    });
  }

  const rawChannels = Array.isArray(input.notificationChannels)
    ? input.notificationChannels
    : input.notificationChannels === undefined || input.notificationChannels === null
      ? []
      : [input.notificationChannels];
  const channels: NotificationDeliveryChannel[] = [];
  for (const candidate of rawChannels) {
    const channel = NOTIFICATION_CHANNELS.find(known => known === candidate);
    if (!channel) {
      issues.push({
        field: 'notificationChannels',
        message: `"${String(candidate)}" is not a notification channel this system can deliver on.`,
      });
      continue;
    }
    if (!channels.includes(channel)) channels.push(channel);
  }

  if (issues.length > 0) return { valid: false, issues };

  return {
    valid: true,
    step: {
      targetType,
      // Exactly one target id survives, so the row can never disagree with
      // itself about what it points at.
      targetUserId: requiredField === 'targetUserId' ? targetId : null,
      targetTeamId: requiredField === 'targetTeamId' ? targetId : null,
      targetScheduleId: requiredField === 'targetScheduleId' ? targetId : null,
      delayMinutes: delayMinutes as number,
      notificationChannels: channels,
      // Lead-only is a team concept; on any other target it is noise that
      // would confuse a later reader of the policy.
      notifyOnlyTeamLead: targetType === 'TEAM' && input.notifyOnlyTeamLead === true,
    },
  };
}

/** True when step orders form 0..n-1 with no gaps or duplicates. */
export function escalationStepOrdersAreContiguous(orders: readonly number[]): boolean {
  if (orders.length === 0) return true;
  const sorted = [...orders].sort((a, b) => a - b);
  return sorted.every((order, index) => order === index);
}

/**
 * Confirms a step's target still exists. Separate from `validateEscalationStep`
 * so the pure rules stay testable without a database, and so this can run in
 * the same transaction as the write it guards.
 */
export async function escalationTargetExists(
  tx: Prisma.TransactionClient,
  targetType: EscalationTargetType,
  targetId: string
): Promise<boolean> {
  if (targetType === 'USER') {
    return (await tx.user.count({ where: { id: targetId, status: 'ACTIVE' } })) > 0;
  }
  if (targetType === 'TEAM') {
    return (await tx.team.count({ where: { id: targetId } })) > 0;
  }
  return (await tx.onCallSchedule.count({ where: { id: targetId } })) > 0;
}

/** First issue as a single operator-facing sentence. */
export function firstEscalationStepIssue(issues: readonly EscalationStepIssue[]): string {
  return issues[0]?.message ?? 'This escalation step is not valid.';
}
