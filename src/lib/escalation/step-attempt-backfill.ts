/**
 * Backfill of EscalationStepAttempt from the last 90 days of escalation timeline text (plan J2).
 *
 * Rows are marked `approximate`: the policy is the service's current one, resolved people are unknown,
 * and the escalation generation is inferred (a step number that does not go up starts a new cycle; the
 * last cycle takes the incident's current generation). Live capture always wins: inserts never overwrite.
 *
 * Bounded and resumable: a keyset walk over incidents created in the window, a fixed number of statements
 * per batch, and a cursor the caller passes back to continue. Safe to re-run from the start. Run by the
 * intelligence lane (the BACKFILL_ESCALATION_ATTEMPTS work item), one batch per item, while escalation insights are on.
 *
 * Job payloads are not read: escalation jobs are retention-swept long before 90 days and carry no outcome.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { EscalationAttemptOutcome, EscalationSkipReason } from './step-attempts';
import { OPS_ROLLUPS, restartOpsRollup } from '@/lib/metric-rollup';

export const STEP_ATTEMPT_BACKFILL_DAYS = 90;
/** Incidents per batch: one lane work item each. */
export const STEP_ATTEMPT_BACKFILL_BATCH = 250;

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
 * The backfill reads only events older than the first live-captured attempt. The scan steps over every
 * approximate row already written (they are older), so a resumable run reads it once and keeps it.
 */
async function backfillUntil(
  prisma: PrismaClient | Prisma.TransactionClient,
  now: Date
): Promise<Date> {
  const firstLive = await prisma.escalationStepAttempt.findFirst({
    where: { approximate: false },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  return firstLive?.createdAt ?? now;
}

/**
 * One bounded batch: up to `batchSize` incidents after `cursor`, three statements (incidents, their
 * escalation events, one insert). Only events older than the first live-captured attempt are read.
 */
export async function backfillEscalationStepAttempts(
  prisma: PrismaClient | Prisma.TransactionClient,
  options: {
    cursor?: StepAttemptBackfillCursor | null;
    batchSize?: number;
    now?: Date;
    /** From `backfillUntil`; read here when omitted. */
    until?: Date;
  } = {}
): Promise<StepAttemptBackfillResult> {
  const now = options.now ?? new Date();
  const batchSize = Math.max(1, Math.min(options.batchSize ?? STEP_ATTEMPT_BACKFILL_BATCH, 1000));
  const since = new Date(now.getTime() - STEP_ATTEMPT_BACKFILL_DAYS * 86_400_000);
  const until = options.until ?? (await backfillUntil(prisma, now));

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

export const ATTEMPT_BACKFILL_CURSOR = 'escalation-attempt-backfill';
/** Stored as the cursor's id once the window is walked: the backfill never runs again. */
export const ATTEMPT_BACKFILL_DONE = '';
/** Holds `until` (as watermarkAt) for the whole walk, read once on the first batch. */
export const ATTEMPT_BACKFILL_UNTIL_CURSOR = `${ATTEMPT_BACKFILL_CURSOR}.until`;

/**
 * One resumable batch: reads the saved keyset cursor, backfills one batch and saves the next cursor on the
 * same client (run it in one transaction so the cursor and the inserts commit together). Returns true when
 * there is more to do.
 */
export async function backfillEscalationStepAttemptsBatch(
  tx: Prisma.TransactionClient,
  options: { now?: Date } = {}
): Promise<boolean> {
  const saved = await tx.intelligenceCursor.findUnique({
    where: { name: ATTEMPT_BACKFILL_CURSOR },
  });
  if (saved?.lastId === ATTEMPT_BACKFILL_DONE) return false;
  const kept = await tx.intelligenceCursor.findUnique({
    where: { name: ATTEMPT_BACKFILL_UNTIL_CURSOR },
    select: { watermarkAt: true },
  });
  const until = kept?.watermarkAt ?? (await backfillUntil(tx, options.now ?? new Date()));
  if (!kept)
    await tx.intelligenceCursor.create({
      data: { name: ATTEMPT_BACKFILL_UNTIL_CURSOR, watermarkAt: until, lastId: '' },
    });
  const result = await backfillEscalationStepAttempts(tx, {
    cursor: saved ? { createdAt: saved.watermarkAt.toISOString(), id: saved.lastId } : null,
    now: options.now,
    until,
  });
  const next = result.cursor
    ? { watermarkAt: new Date(result.cursor.createdAt), lastId: result.cursor.id }
    : { watermarkAt: options.now ?? new Date(), lastId: ATTEMPT_BACKFILL_DONE };
  await tx.intelligenceCursor.upsert({
    where: { name: ATTEMPT_BACKFILL_CURSOR },
    create: { name: ATTEMPT_BACKFILL_CURSOR, ...next },
    update: next,
  });
  // The rows just written sit on days the step-outcome rollup may already have sealed: roll them again.
  if (!result.cursor) await restartOpsRollup(tx, OPS_ROLLUPS.escalationStepOutcome);
  return result.cursor !== null;
}
