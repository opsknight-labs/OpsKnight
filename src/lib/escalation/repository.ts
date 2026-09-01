/**
 * Durable persistence for the escalation engine.
 *
 * Everything that changes escalation state goes through this module, and the
 * outcome of a step lands in exactly one serializable transaction:
 *
 *   verify generation -> assignment -> timeline -> escalation state -> next job
 *
 * The next job is created inside that transaction on purpose. When state
 * advanced in one transaction and the follow-up job was inserted afterwards, a
 * crash in between left an incident sitting at "step 2, due at T" with nothing
 * scheduled to run it.
 */
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { runSerializableTransaction } from '../db-utils';
import { logger } from '../logger';
import type { EscalationAssignment } from './assignee-selection';
import type { EscalationPlan } from './planner';
import {
  escalationLifecycleGate,
  type EscalationLifecycleGate,
  type EscalationStatus,
} from './state';

/**
 * A worker's claim timestamp doubles as its lifecycle-generation token: any
 * real lifecycle transition clears `escalationProcessingAt`, and a timed-out
 * reclaim replaces it. Either event makes this worker stale.
 */
export type EscalationWorkerToken = Date;

export type EscalationCommitResult =
  | {
      committed: true;
      gate: EscalationLifecycleGate;
      appliedStatus: EscalationStatus;
      nextJobId: string | null;
    }
  | { committed: false };

type IncidentStateRow = {
  status: string;
  assigneeId: string | null;
  teamId: string | null;
  escalationStatus: string | null;
  escalationProcessingAt: Date | null;
  currentEscalationStep: number | null;
  escalationGeneration: number | null;
};

const INCIDENT_STATE_SELECT = {
  status: true,
  assigneeId: true,
  teamId: true,
  escalationStatus: true,
  escalationProcessingAt: true,
  currentEscalationStep: true,
  escalationGeneration: true,
} as const;

/**
 * Production selects always include `escalationProcessingAt`. `undefined` is
 * tolerated for partial adapters; a persisted NULL explicitly means a
 * lifecycle transition invalidated this worker's generation.
 */
export function escalationWorkerInvalidated(
  currentLock: Date | null | undefined,
  workerToken: EscalationWorkerToken
): boolean {
  if (currentLock === null) return true;
  return currentLock instanceof Date && currentLock.getTime() !== workerToken.getTime();
}

/** assigneeId and teamId are mutually exclusive, so each write clears the other. */
export function assignmentUpdateData(assignment: EscalationAssignment): Prisma.IncidentUpdateInput {
  return assignment.type === 'TEAM'
    ? { team: { connect: { id: assignment.teamId } }, assignee: { disconnect: true } }
    : { assignee: { connect: { id: assignment.userId } }, team: { disconnect: true } };
}

/**
 * Logical identity of an escalation job. Carried in the payload so a future
 * unique constraint can dedupe on it; nothing branches on it yet.
 */
function escalationJobKey(incidentId: string, generation: number, stepIndex: number): string {
  return `ESCALATION:${incidentId}:${generation}:${stepIndex}`;
}

async function createEscalationJob(
  tx: Prisma.TransactionClient,
  input: { incidentId: string; generation: number; stepIndex: number; scheduledAt: Date }
): Promise<string> {
  const job = await tx.backgroundJob.create({
    data: {
      type: 'ESCALATION',
      status: 'PENDING',
      scheduledAt: input.scheduledAt,
      maxAttempts: 3,
      payload: {
        incidentId: input.incidentId,
        stepIndex: input.stepIndex,
        generation: input.generation,
        logicalKey: escalationJobKey(input.incidentId, input.generation, input.stepIndex),
      },
    },
    select: { id: true },
  });
  return job.id;
}

export type EscalationClaim =
  | { claimed: true; token: EscalationWorkerToken }
  /** Another live worker holds this generation + step. */
  | { claimed: false; reason: 'HELD' }
  /** A newer lifecycle generation, or a terminal state, invalidated this work. */
  | { claimed: false; reason: 'SUPERSEDED' };

/**
 * Atomically takes ownership of one generation + step for this worker.
 *
 * The compare-and-set covers the lifecycle generation as well as the step
 * cursor and the lease, so a job created for generation N can never claim an
 * incident that has since moved to generation N+1 — the point being that this
 * happens *before* any responder page is dispatched, not after.
 */
export async function claimEscalationStep(input: {
  incidentId: string;
  stepIndex: number;
  /**
   * The generation this work belongs to. Omitted only for legacy job payloads
   * written before generations were carried, which cannot be verified.
   */
  expectedGeneration?: number;
  now: Date;
  lockTimeoutMs: number;
}): Promise<EscalationClaim> {
  const lockCutoff = new Date(input.now.getTime() - input.lockTimeoutMs);
  // Step 0 may still be uninitialised (null cursor and null status) because an
  // incident that escalates immediately has never been through a step yet.
  const stepMatch =
    input.stepIndex === 0
      ? { OR: [{ currentEscalationStep: null }, { currentEscalationStep: 0 }] }
      : { currentEscalationStep: input.stepIndex };
  const statusMatch =
    input.stepIndex === 0
      ? { OR: [{ escalationStatus: null }, { escalationStatus: 'ESCALATING' }] }
      : { escalationStatus: 'ESCALATING' };

  const claim = await prisma.incident.updateMany({
    where: {
      id: input.incidentId,
      status: 'OPEN',
      ...(input.expectedGeneration === undefined
        ? {}
        : { escalationGeneration: input.expectedGeneration }),
      AND: [
        stepMatch,
        statusMatch,
        {
          OR: [{ escalationProcessingAt: null }, { escalationProcessingAt: { lt: lockCutoff } }],
        },
      ],
    },
    data: {
      escalationStatus: 'ESCALATING',
      currentEscalationStep: input.stepIndex,
      escalationProcessingAt: input.now,
    },
  });

  if (claim.count > 0) return { claimed: true, token: input.now };

  // The CAS covers several conditions at once. Re-read to tell "someone else is
  // working on it" apart from "this work no longer belongs to any generation",
  // because the two lead to different job outcomes.
  const current = await prisma.incident.findUnique({
    where: { id: input.incidentId },
    select: { status: true, escalationStatus: true, escalationGeneration: true },
  });

  const superseded =
    !current ||
    current.status !== 'OPEN' ||
    current.escalationStatus === 'COMPLETED' ||
    current.escalationStatus === 'PAUSED' ||
    current.escalationStatus === 'FAILED' ||
    (input.expectedGeneration !== undefined &&
      current.escalationGeneration !== input.expectedGeneration);

  return { claimed: false, reason: superseded ? 'SUPERSEDED' : 'HELD' };
}

/**
 * Cancels PENDING escalation jobs that belong to a generation the incident has
 * moved past. Their payload identifies the generation they were created for;
 * a job with no generation is left alone, since it cannot be judged stale.
 */
export async function cancelSupersededEscalationJobs(input: {
  incidentId: string;
  currentGeneration: number;
  store?: { backgroundJob: Prisma.TransactionClient['backgroundJob'] };
}): Promise<number> {
  const store = input.store ?? prisma;
  const result = await store.backgroundJob.updateMany({
    where: {
      type: 'ESCALATION',
      status: 'PENDING',
      payload: { path: ['incidentId'], equals: input.incidentId },
      NOT: { payload: { path: ['generation'], equals: input.currentGeneration } },
      AND: [{ NOT: { payload: { path: ['generation'], equals: Prisma.DbNull } } }],
    },
    data: { status: 'CANCELLED', error: 'Superseded by a newer escalation generation' },
  });
  return result.count;
}

/**
 * Releases this worker's processing lease without changing escalation state,
 * so a retry after an infrastructure failure is not blocked until the lease
 * times out. Best effort: the lease timeout is the backstop.
 */
export async function releaseEscalationClaim(
  incidentId: string,
  workerToken: EscalationWorkerToken
): Promise<void> {
  try {
    await prisma.incident.updateMany({
      where: { id: incidentId, escalationProcessingAt: workerToken },
      data: { escalationProcessingAt: null },
    });
  } catch (error) {
    logger.warn('escalation.claim.release_failed', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Applies the planned owner before responder pages are dispatched, so the page
 * and every board name the same person. Idempotent, generation-fenced, and a
 * no-op when the incident already has an owner.
 *
 * Returns false when a newer generation invalidated this worker.
 */
export async function applyPlannedAssignment(input: {
  incidentId: string;
  workerToken: EscalationWorkerToken;
  assignment: EscalationAssignment | null;
}): Promise<boolean> {
  return runSerializableTransaction(async tx => {
    const current = (await tx.incident.findUnique({
      where: { id: input.incidentId },
      select: { assigneeId: true, teamId: true, escalationProcessingAt: true },
    })) as Pick<IncidentStateRow, 'assigneeId' | 'teamId' | 'escalationProcessingAt'> | null;

    if (
      !current ||
      escalationWorkerInvalidated(current.escalationProcessingAt, input.workerToken)
    ) {
      return false;
    }
    if (current.assigneeId || current.teamId || !input.assignment) return true;

    await tx.incident.update({
      where: { id: input.incidentId },
      data: assignmentUpdateData(input.assignment),
    });
    return true;
  });
}

/**
 * Confirms this worker still owns its generation. Used between page dispatches
 * so a stale worker stops paging as soon as a lifecycle transition lands.
 */
export async function escalationGenerationStillOwned(
  incidentId: string,
  workerToken: EscalationWorkerToken,
  expectedGeneration?: number
): Promise<boolean> {
  const current = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      status: true,
      escalationStatus: true,
      escalationProcessingAt: true,
      escalationGeneration: true,
    },
  });
  if (!current) return false;
  if (current.status !== 'OPEN') return false;
  if (current.escalationStatus === 'COMPLETED') return false;
  if (
    expectedGeneration !== undefined &&
    typeof current.escalationGeneration === 'number' &&
    current.escalationGeneration !== expectedGeneration
  ) {
    return false;
  }
  return !escalationWorkerInvalidated(current.escalationProcessingAt, workerToken);
}

/**
 * The single commit path for a step's outcome.
 *
 * Assignment, timeline, escalation state, and the next escalation job either
 * all land or none do. A lifecycle transition that arrived while pages were
 * being dispatched wins: the plan's next state is overridden by the newer
 * lifecycle state rather than re-arming the incident.
 */
export async function commitEscalationPlan(input: {
  incidentId: string;
  generation: number;
  expectedStep: number;
  workerToken: EscalationWorkerToken;
  plan: EscalationPlan;
}): Promise<EscalationCommitResult> {
  return runSerializableTransaction<EscalationCommitResult>(async tx => {
    const current = (await tx.incident.findUnique({
      where: { id: input.incidentId },
      select: INCIDENT_STATE_SELECT,
    })) as IncidentStateRow | null;

    if (
      !current ||
      escalationWorkerInvalidated(current.escalationProcessingAt, input.workerToken)
    ) {
      return { committed: false };
    }

    // A generation that moved on belongs to a different escalation run.
    if (
      typeof current.escalationGeneration === 'number' &&
      current.escalationGeneration !== input.generation
    ) {
      return { committed: false };
    }

    // A cursor pointing at a different step belongs to another execution. An
    // absent cursor is expected: a terminal lifecycle transition clears it.
    if (
      typeof current.currentEscalationStep === 'number' &&
      current.currentEscalationStep !== input.expectedStep
    ) {
      return { committed: false };
    }

    const gate = escalationLifecycleGate(current);
    const planned = input.plan.nextState;

    // A stopped incident clears its cursor. A paused one keeps the step it
    // should resume from, which is the step *after* the one just paged: its
    // responder pages have already gone out.
    const nextState =
      gate === 'STOPPED'
        ? { status: 'COMPLETED' as EscalationStatus, currentStep: null, nextEscalationAt: null }
        : gate === 'PAUSED'
          ? {
              status: 'PAUSED' as EscalationStatus,
              currentStep: planned.currentStep,
              nextEscalationAt: null,
            }
          : planned;

    const updateData: Prisma.IncidentUpdateInput = {
      escalationStatus: nextState.status,
      currentEscalationStep: nextState.currentStep,
      nextEscalationAt: nextState.nextEscalationAt,
      escalationProcessingAt: null,
    };

    if (!current.assigneeId && !current.teamId && input.plan.assignment) {
      Object.assign(updateData, assignmentUpdateData(input.plan.assignment));
    }

    // A step whose outcome a lifecycle transition already overrode does not
    // narrate itself into the timeline; the structured log records that it ran.
    if (gate === 'ACTIVE') {
      for (const event of input.plan.timelineEvents) {
        await tx.incidentEvent.create({
          data: {
            incidentId: input.incidentId,
            ...(event.type ? { type: event.type } : {}),
            message: event.message,
          },
        });
      }
    }

    await tx.incident.update({ where: { id: input.incidentId }, data: updateData });

    const nextJob =
      gate === 'ACTIVE' && input.plan.nextJob && nextState.status === 'ESCALATING'
        ? await createEscalationJob(tx, {
            incidentId: input.incidentId,
            generation: input.generation,
            stepIndex: input.plan.nextJob.stepIndex,
            scheduledAt: input.plan.nextJob.scheduledAt,
          })
        : null;

    return { committed: true, gate, appliedStatus: nextState.status, nextJobId: nextJob };
  });
}

/**
 * Arms a step that has lead time before it may execute: escalation state, the
 * timeline note, and the due job commit together.
 */
export async function scheduleDelayedEscalationStep(input: {
  incidentId: string;
  generation: number;
  stepIndex: number;
  delayMinutes: number;
  dueAt: Date;
}): Promise<void> {
  await runSerializableTransaction(async tx => {
    await tx.incident.update({
      where: { id: input.incidentId },
      data: {
        escalationStatus: 'ESCALATING',
        currentEscalationStep: input.stepIndex,
        nextEscalationAt: input.dueAt,
        escalationProcessingAt: null,
      },
    });

    await tx.incidentEvent.create({
      data: {
        incidentId: input.incidentId,
        message: `Escalation scheduled for [[scheduledAt=${input.dueAt.toISOString()}]] (${input.delayMinutes} minute delay)`,
      },
    });

    await createEscalationJob(tx, {
      incidentId: input.incidentId,
      generation: input.generation,
      stepIndex: input.stepIndex,
      scheduledAt: input.dueAt,
    });
  });
}

/**
 * Parks an execution in a terminal state with no further work: the policy ran
 * out, was removed, or its step vanished. `status: null` clears escalation
 * entirely, which is what a service with no policy should look like.
 */
export async function finalizeEscalationExecution(input: {
  incidentId: string;
  status: EscalationStatus | null;
  timelineMessage?: string;
}): Promise<void> {
  await runSerializableTransaction(async tx => {
    await tx.incident.update({
      where: { id: input.incidentId },
      data: {
        escalationStatus: input.status,
        nextEscalationAt: null,
        currentEscalationStep: null,
        escalationProcessingAt: null,
      },
    });

    if (input.timelineMessage) {
      await tx.incidentEvent.create({
        data: {
          incidentId: input.incidentId,
          type: 'ESCALATED',
          message: input.timelineMessage,
        },
      });
    }
  });
}
