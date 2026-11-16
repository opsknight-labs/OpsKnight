/**
 * Escalation step attempt capture (analytics only).
 *
 * One row per incident + generation + step, written in the SAME SQL statement
 * as the step's timeline event, so capture adds no round trip and no read to
 * the escalation commit path. The engine never reads this table.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { EscalationTargetResolution } from './target-resolution';

export const ESCALATION_ATTEMPT_OUTCOMES = ['SCHEDULED', 'NOTIFIED', 'SKIPPED', 'FAILED'] as const;
export type EscalationAttemptOutcome = (typeof ESCALATION_ATTEMPT_OUTCOMES)[number];

export const ESCALATION_SKIP_REASONS = [
  'CONDITIONS_NOT_MATCHED',
  'NO_TARGET',
  'TARGET_MISSING',
  'TARGET_INACTIVE',
  'TARGET_INVALID',
  'NO_ONE_ON_CALL',
  'NO_ELIGIBLE_MEMBERS',
  'NO_ELIGIBLE_RESPONDERS',
  'NO_CONTACT_METHOD',
] as const;
export type EscalationSkipReason = (typeof ESCALATION_SKIP_REASONS)[number];

export interface EscalationStepAttemptRecord {
  policyId: string | null;
  policyRevision: number | null;
  targetType: string | null;
  targetId: string | null;
  resolvedUserIds: string[];
  outcome: EscalationAttemptOutcome;
  skipReason: EscalationSkipReason | null;
  notifiedAt: Date | null;
}

/** Maps what the planner already decided onto an attempt row. Pure; reads nothing. */
export function escalationAttemptForStep(input: {
  policyId: string | null;
  /** Synthetic (automation-pinned) policies report revision 0, stored as null. */
  policyRevision?: number | null;
  targetType: string;
  targetId: string | null;
  applicable: boolean;
  resolution: EscalationTargetResolution;
  /** Recipients with no reachable channel, from the step's notification plan. */
  unreachableUserIds?: readonly string[];
  now: Date;
}): EscalationStepAttemptRecord {
  const base = {
    policyId: input.policyId,
    policyRevision: input.policyRevision || null,
    targetType: input.targetType,
    targetId: input.targetId,
  };
  const skipped = (skipReason: EscalationSkipReason): EscalationStepAttemptRecord => ({
    ...base,
    resolvedUserIds: [],
    outcome: 'SKIPPED',
    skipReason,
    notifiedAt: null,
  });

  if (!input.applicable) return skipped('CONDITIONS_NOT_MATCHED');
  if (input.targetId === null) return skipped('NO_TARGET');
  if (input.resolution.outcome === 'INVALID_TARGET') {
    return skipped(input.resolution.code ?? 'TARGET_INVALID');
  }
  const userIds = input.resolution.outcome === 'RESOLVED' ? input.resolution.userIds : [];
  if (userIds.length === 0) {
    return skipped(
      input.targetType === 'SCHEDULE'
        ? 'NO_ONE_ON_CALL'
        : input.targetType === 'TEAM'
          ? 'NO_ELIGIBLE_MEMBERS'
          : 'NO_ELIGIBLE_RESPONDERS'
    );
  }

  const unreachable = new Set(input.unreachableUserIds ?? []);
  const reached = userIds.some(id => !unreachable.has(id));
  return {
    ...base,
    resolvedUserIds: [...userIds],
    outcome: reached ? 'NOTIFIED' : 'FAILED',
    skipReason: reached ? null : 'NO_CONTACT_METHOD',
    notifiedAt: reached ? input.now : null,
  };
}

/**
 * A cuid-shaped id whose counter block is the lowest possible, so it sorts
 * before any id Prisma generates later in the same millisecond and the
 * timeline keeps its insertion order on createdAt ties.
 */
function timelineEventId(): string {
  const stamp = Date.now().toString(36).padStart(8, '0');
  return `c${stamp}0000${randomBytes(8).toString('hex').slice(0, 12)}`;
}

/**
 * Inserts a timeline event and upserts its step attempt in one statement.
 * A step armed with a delay first lands as SCHEDULED; executing it overwrites
 * that row with the real outcome.
 */
export async function insertTimelineEventWithAttempt(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  input: {
    incidentId: string;
    generation: number;
    stepIndex: number;
    event: { type?: 'ESCALATED'; message: string };
    attempt: EscalationStepAttemptRecord;
  }
): Promise<void> {
  const a = input.attempt;
  await tx.$executeRaw`
    WITH event AS (
      INSERT INTO "IncidentEvent" (id, "incidentId", type, message)
      VALUES (${timelineEventId()}, ${input.incidentId},
              ${input.event.type ?? null}::"IncidentEventType", ${input.event.message})
    )
    INSERT INTO "EscalationStepAttempt"
      ("incidentId", generation, "stepIndex", "policyId", "policyRevision", "targetType",
       "targetId", "resolvedUserIds", outcome, "skipReason", "notifiedAt")
    VALUES (${input.incidentId}, ${input.generation}, ${input.stepIndex}, ${a.policyId},
            ${a.policyRevision}, ${a.targetType}, ${a.targetId}, ${a.resolvedUserIds}::text[],
            ${a.outcome}, ${a.skipReason}, ${a.notifiedAt})
    ON CONFLICT ("incidentId", generation, "stepIndex") DO UPDATE SET
      "policyId" = EXCLUDED."policyId", "policyRevision" = EXCLUDED."policyRevision",
      "targetType" = EXCLUDED."targetType", "targetId" = EXCLUDED."targetId",
      "resolvedUserIds" = EXCLUDED."resolvedUserIds", outcome = EXCLUDED.outcome,
      "skipReason" = EXCLUDED."skipReason", "notifiedAt" = EXCLUDED."notifiedAt",
      approximate = false
  `;
}
