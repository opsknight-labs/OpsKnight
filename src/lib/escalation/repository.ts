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
  materializeEscalationNotificationIntents,
  type EscalationNotificationPlan,
} from './notification-intents';
import { notifyEscalationWorkPending } from './worker';
import {
  escalationDueAt,
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
      /** Responder pages durably persisted by this commit. */
      intentsCreated: number;
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
  const logicalKey = escalationJobKey(input.incidentId, input.generation, input.stepIndex);
  const existing = await tx.backgroundJob.findFirst({
    where: {
      type: 'ESCALATION',
      status: { in: ['PENDING', 'PROCESSING'] },
      payload: { path: ['logicalKey'], equals: logicalKey },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

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
        logicalKey,
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
 * This is the only place an escalation step mutates anything. Assignment,
 * responder pages, timeline, escalation state, and the next escalation job
 * either all land or none do — there is no earlier write to leave behind. A lifecycle transition that arrived while pages were
 * being dispatched wins: the plan's next state is overridden by the newer
 * lifecycle state rather than re-arming the incident.
 */
export async function commitEscalationPlan(input: {
  incidentId: string;
  generation: number;
  expectedStep: number;
  workerToken: EscalationWorkerToken;
  plan: EscalationPlan;
  /**
   * The step's responder pages, resolved but not yet persisted. They are
   * written inside this transaction, so a step cannot report itself executed
   * while a responder it meant to page exists nowhere durable.
   */
  notifications?: EscalationNotificationPlan;
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

    // Pages are materialized before the state advances. If this throws, the
    // whole step rolls back rather than advancing past an unrecorded page.
    const intents =
      gate === 'ACTIVE' && input.notifications
        ? await materializeEscalationNotificationIntents(tx, input.notifications)
        : { created: 0 };

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

    // A next step that is already due should not wait out an idle poll.
    if (nextJob && input.plan.nextJob && input.plan.nextJob.scheduledAt.getTime() <= Date.now()) {
      notifyEscalationWorkPending();
    }

    return {
      committed: true,
      gate,
      appliedStatus: nextState.status,
      nextJobId: nextJob,
      intentsCreated: intents.created,
    };
  });
}

/**
 * Arms an incident's escalation execution for its policy's first step.
 *
 * Called inside the incident-creation transaction so an OPEN incident with a
 * policy can never commit without recoverable escalation state. Before this,
 * the first step existed only as an outbox side effect: lose that row and the
 * incident sat OPEN with `escalationStatus = null` and nothing due.
 *
 * Returns `initialized: false` when the service has no policy to run.
 */
export async function initializeEscalationExecution(
  tx: Prisma.TransactionClient,
  input: { incidentId: string; serviceId: string; now?: Date }
): Promise<{ initialized: boolean; dueAt: Date | null }> {
  const service = await tx.service.findUnique({
    where: { id: input.serviceId },
    select: {
      policy: {
        select: {
          steps: { orderBy: { stepOrder: 'asc' }, take: 1, select: { delayMinutes: true } },
        },
      },
    },
  });

  const firstStep = service?.policy?.steps[0];
  if (!firstStep) return { initialized: false, dueAt: null };

  const dueAt = escalationDueAt(input.now ?? new Date(), firstStep.delayMinutes);
  const initialized = await tx.incident.updateMany({
    where: {
      id: input.incidentId,
      serviceId: input.serviceId,
      status: 'OPEN',
      escalationStatus: null,
    },
    data: {
      escalationStatus: 'ESCALATING',
      currentEscalationStep: 0,
      nextEscalationAt: dueAt,
      escalationProcessingAt: null,
    },
  });
  if (initialized.count === 0) return { initialized: false, dueAt: null };

  const incident = await tx.incident.findUnique({
    where: { id: input.incidentId },
    select: { escalationGeneration: true },
  });
  if (!incident) return { initialized: false, dueAt: null };

  await createEscalationJob(tx, {
    incidentId: input.incidentId,
    generation: incident.escalationGeneration ?? 0,
    stepIndex: 0,
    scheduledAt: dueAt,
  });

  return { initialized: true, dueAt };
}

/**
 * Lifecycle commands that open a new escalation run and therefore owe a job.
 *
 * REOPEN restarts at step 0; the other three resume from the cursor the pause
 * preserved. All four increment the generation, which is what makes every
 * escalation job created for the previous run stale.
 */
export const ESCALATION_RESUME_COMMANDS = [
  'REOPEN',
  'UNACKNOWLEDGE',
  'UNSNOOZE',
  'UNSUPPRESS',
] as const;

export type EscalationResumeCommand = (typeof ESCALATION_RESUME_COMMANDS)[number];

export function isEscalationResumeCommand(command: string): command is EscalationResumeCommand {
  return (ESCALATION_RESUME_COMMANDS as readonly string[]).includes(command);
}

/**
 * Arms the escalation job for a run a lifecycle transition just resumed.
 *
 * Called inside the lifecycle transaction, so the new generation's due state
 * and the job that will execute it commit together. Without this, three of the
 * four resume commands set `nextEscalationAt` and left the job to be
 * discovered by the fallback scan or the reconciliation pass — recoverable,
 * but a resumed page waited on a scanner interval instead of running when it
 * was due.
 *
 * Reads the state the lifecycle engine just wrote rather than being told it, so
 * there is one answer to "which step is now due" instead of two.
 */
export async function resumeEscalationExecution(
  tx: Prisma.TransactionClient,
  input: { incidentId: string; reason: string }
): Promise<{ resumed: boolean; jobId: string | null }> {
  const incident = await tx.incident.findUnique({
    where: { id: input.incidentId },
    select: {
      status: true,
      escalationStatus: true,
      currentEscalationStep: true,
      nextEscalationAt: true,
      escalationGeneration: true,
    },
  });

  // Nothing to arm unless the transition actually left an active execution with
  // a due time — a service with no policy, or a command that paused instead.
  if (
    !incident ||
    incident.status !== 'OPEN' ||
    incident.escalationStatus !== 'ESCALATING' ||
    !incident.nextEscalationAt
  ) {
    return { resumed: false, jobId: null };
  }

  // Every pending escalation job belongs to the run this transition superseded.
  await tx.backgroundJob.updateMany({
    where: {
      type: 'ESCALATION',
      status: 'PENDING',
      payload: { path: ['incidentId'], equals: input.incidentId },
    },
    data: { status: 'CANCELLED', error: input.reason },
  });

  const jobId = await createEscalationJob(tx, {
    incidentId: input.incidentId,
    generation: incident.escalationGeneration ?? 0,
    stepIndex: incident.currentEscalationStep ?? 0,
    scheduledAt: incident.nextEscalationAt,
  });

  return { resumed: true, jobId };
}

/**
 * Recreates the due job for an execution whose state says work is owed but
 * whose job row is gone. Used only by reconciliation; it does not advance the
 * cursor, so a duplicate job is harmless — the claim CAS admits one worker.
 */
export async function recreateDueEscalationJob(input: {
  incidentId: string;
  generation: number;
  stepIndex: number;
  scheduledAt: Date;
}): Promise<string | null> {
  return runSerializableTransaction(async tx => {
    const current = await tx.incident.findUnique({
      where: { id: input.incidentId },
      select: {
        status: true,
        escalationStatus: true,
        escalationGeneration: true,
        currentEscalationStep: true,
        nextEscalationAt: true,
      },
    });
    if (
      !current ||
      current.status !== 'OPEN' ||
      current.escalationStatus !== 'ESCALATING' ||
      (current.escalationGeneration ?? 0) !== input.generation ||
      (current.currentEscalationStep ?? 0) !== input.stepIndex ||
      !current.nextEscalationAt ||
      current.nextEscalationAt.getTime() > input.scheduledAt.getTime()
    ) {
      return null;
    }
    return createEscalationJob(tx, input);
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
}): Promise<boolean> {
  return runSerializableTransaction(async tx => {
    const stepMatch =
      input.stepIndex === 0
        ? { OR: [{ currentEscalationStep: null }, { currentEscalationStep: 0 }] }
        : { currentEscalationStep: input.stepIndex };
    const statusMatch =
      input.stepIndex === 0
        ? { OR: [{ escalationStatus: null }, { escalationStatus: 'ESCALATING' }] }
        : { escalationStatus: 'ESCALATING' };

    // This CAS is both a lifecycle fence and a dedupe boundary. If another
    // worker armed the delay, or ACK/resolve/reopen changed the generation
    // after our read, no timeline event or duplicate job may be written.
    const armed = await tx.incident.updateMany({
      where: {
        id: input.incidentId,
        status: 'OPEN',
        escalationGeneration: input.generation,
        escalationProcessingAt: null,
        nextEscalationAt: null,
        AND: [stepMatch, statusMatch],
      },
      data: {
        escalationStatus: 'ESCALATING',
        currentEscalationStep: input.stepIndex,
        nextEscalationAt: input.dueAt,
        escalationProcessingAt: null,
      },
    });
    if (armed.count === 0) return false;

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
    return true;
  });
}

/**
 * Parks an execution in a terminal state with no further work: the policy ran
 * out, was removed, or its step vanished. `status: null` clears escalation
 * entirely, which is what a service with no policy should look like.
 */
export async function finalizeEscalationExecution(input: {
  incidentId: string;
  expectedGeneration: number;
  expectedStep: number;
  status: EscalationStatus | null;
  timelineMessage?: string;
}): Promise<boolean> {
  return runSerializableTransaction(async tx => {
    const stepMatch =
      input.expectedStep === 0
        ? { OR: [{ currentEscalationStep: null }, { currentEscalationStep: 0 }] }
        : { currentEscalationStep: input.expectedStep };
    const finalized = await tx.incident.updateMany({
      where: {
        id: input.incidentId,
        status: 'OPEN',
        escalationGeneration: input.expectedGeneration,
        ...stepMatch,
      },
      data: {
        escalationStatus: input.status,
        nextEscalationAt: null,
        currentEscalationStep: null,
        escalationProcessingAt: null,
      },
    });
    if (finalized.count === 0) return false;

    if (input.timelineMessage) {
      await tx.incidentEvent.create({
        data: {
          incidentId: input.incidentId,
          type: 'ESCALATED',
          message: input.timelineMessage,
        },
      });
    }
    return true;
  });
}
