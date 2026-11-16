/**
 * Backfill of EscalationStepAttempt from the last 90 days of escalation timeline text (plan J2).
 *
 * Rows are marked `approximate`: the policy is the service's current one, resolved people are unknown,
 * and the escalation generation is inferred (a step number that does not go up starts a new cycle; the
 * last cycle takes the incident's current generation). Live capture always wins: inserts never overwrite.
 *
 * Bounded and resumable: a keyset walk over incidents created in the window, a fixed number of statements
 * per batch, and a cursor the caller passes back to continue. Safe to re-run from the start.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { EscalationAttemptOutcome, EscalationSkipReason } from './step-attempts';

export const STEP_ATTEMPT_BACKFILL_DAYS = 90;

export interface BackfilledAttempt {
  generation: number;
  stepIndex: number;
  targetType: string | null;
  outcome: EscalationAttemptOutcome;
  skipReason: EscalationSkipReason | null;
  at: Date;
}

type ParsedStep = Omit<BackfilledAttempt, 'generation' | 'at'>;

const NO_USERS_REASON: Record<string, EscalationSkipReason> = {
  SCHEDULE: 'NO_ONE_ON_CALL',
  TEAM: 'NO_ELIGIBLE_MEMBERS',
  USER: 'NO_ELIGIBLE_RESPONDERS',
};

/** Reads one planner timeline message (see planner.ts); null for anything else. */
export function parseEscalationMessage(message: string): ParsedStep | null {
  if (message.startsWith('Escalated to ')) {
    const level = /^\(Level (\d+)[,)]/.exec(message.slice(message.lastIndexOf('(Level ')));
    if (!level) return null;
    const typed = /^Escalated to (TEAM|SCHEDULE): /.exec(message);
    return {
      stepIndex: Number(level[1]) - 1,
      targetType: typed?.[1] ?? 'USER',
      outcome: 'NOTIFIED',
      skipReason: null,
    };
  }
  let match = /^Escalation step (\d+) conditions did not match\./.exec(message);
  if (match) {
    return {
      stepIndex: Number(match[1]) - 1,
      targetType: null,
      outcome: 'SKIPPED',
      skipReason: 'CONDITIONS_NOT_MATCHED',
    };
  }
  match =
    /^Escalation step (\d+) has invalid target configuration \((\w+) with no target ID\)/.exec(
      message
    );
  if (match) {
    return {
      stepIndex: Number(match[1]) - 1,
      targetType: match[2],
      outcome: 'SKIPPED',
      skipReason: 'NO_TARGET',
    };
  }
  match = /^Escalation step (\d+) \((\w+)\) has an unusable target: (.*)$/.exec(message);
  if (match) {
    const reason = match[3];
    return {
      stepIndex: Number(match[1]) - 1,
      targetType: match[2],
      outcome: 'SKIPPED',
      skipReason: reason.includes('no longer exists')
        ? 'TARGET_MISSING'
        : reason.includes('not an active responder')
          ? 'TARGET_INACTIVE'
          : 'TARGET_INVALID',
    };
  }
  match = /^Escalation step (\d+) \((\w+): .*\) resolved to no users\./.exec(message);
  if (match) {
    return {
      stepIndex: Number(match[1]) - 1,
      targetType: match[2],
      outcome: 'SKIPPED',
      skipReason: NO_USERS_REASON[match[2]] ?? 'NO_ELIGIBLE_RESPONDERS',
    };
  }
  return null;
}

/** One incident's escalation messages, oldest first, as attempts with an inferred generation. */
export function attemptsFromTimeline(
  events: ReadonlyArray<{ message: string; createdAt: Date }>,
  currentGeneration: number
): BackfilledAttempt[] {
  const parsed: Array<ParsedStep & { cycle: number; at: Date }> = [];
  let cycle = 0;
  for (const event of events) {
    const step = parseEscalationMessage(event.message);
    if (!step || step.stepIndex < 0) continue;
    const previous = parsed.at(-1);
    if (previous && step.stepIndex <= previous.stepIndex) cycle += 1;
    parsed.push({ ...step, cycle, at: event.createdAt });
  }
  return parsed.map(({ cycle: own, ...step }) => ({
    ...step,
    generation: currentGeneration - (cycle - own),
  }));
}

export interface StepAttemptBackfillCursor {
  createdAt: string;
  id: string;
}

export interface StepAttemptBackfillResult {
  incidents: number;
  inserted: number;
  /** Pass back to continue; null when the window is done. */
  cursor: StepAttemptBackfillCursor | null;
}

/**
 * One bounded batch: up to `batchSize` incidents after `cursor`, three statements (incidents, their
 * escalation events, one insert). Only events older than the first live-captured attempt are read.
 */
export async function backfillEscalationStepAttempts(
  prisma: PrismaClient,
  options: { cursor?: StepAttemptBackfillCursor | null; batchSize?: number; now?: Date } = {}
): Promise<StepAttemptBackfillResult> {
  const now = options.now ?? new Date();
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 200, 1000));
  const since = new Date(now.getTime() - STEP_ATTEMPT_BACKFILL_DAYS * 86_400_000);
  const firstLive = await prisma.escalationStepAttempt.findFirst({
    where: { approximate: false },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const until = firstLive?.createdAt ?? now;

  const after = options.cursor;
  const incidents = await prisma.incident.findMany({
    where: {
      createdAt: { gte: since, lt: until },
      ...(after
        ? {
            OR: [
              { createdAt: { gt: new Date(after.createdAt) } },
              { createdAt: new Date(after.createdAt), id: { gt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: batchSize,
    select: {
      id: true,
      createdAt: true,
      escalationGeneration: true,
      service: { select: { escalationPolicyId: true } },
    },
  });
  if (incidents.length === 0) return { incidents: 0, inserted: 0, cursor: null };

  const events = await prisma.incidentEvent.findMany({
    where: {
      incidentId: { in: incidents.map(incident => incident.id) },
      createdAt: { lt: until },
      message: { startsWith: 'Escalat' },
    },
    orderBy: [{ incidentId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { incidentId: true, message: true, createdAt: true },
  });
  const byIncident = new Map<string, Array<{ message: string; createdAt: Date }>>();
  for (const event of events) {
    const list = byIncident.get(event.incidentId) ?? [];
    list.push(event);
    byIncident.set(event.incidentId, list);
  }

  const rows: Prisma.EscalationStepAttemptCreateManyInput[] = [];
  for (const incident of incidents) {
    for (const attempt of attemptsFromTimeline(
      byIncident.get(incident.id) ?? [],
      incident.escalationGeneration
    )) {
      rows.push({
        incidentId: incident.id,
        generation: attempt.generation,
        stepIndex: attempt.stepIndex,
        policyId: incident.service.escalationPolicyId,
        targetType: attempt.targetType,
        outcome: attempt.outcome,
        skipReason: attempt.skipReason,
        notifiedAt: attempt.outcome === 'NOTIFIED' ? attempt.at : null,
        approximate: true,
        createdAt: attempt.at,
      });
    }
  }
  const { count } = rows.length
    ? await prisma.escalationStepAttempt.createMany({ data: rows, skipDuplicates: true })
    : { count: 0 };

  const last = incidents[incidents.length - 1];
  return {
    incidents: incidents.length,
    inserted: count,
    cursor:
      incidents.length < batchSize
        ? null
        : { createdAt: last.createdAt.toISOString(), id: last.id },
  };
}
