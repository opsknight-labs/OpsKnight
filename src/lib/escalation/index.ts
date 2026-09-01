import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { runSerializableTransaction } from '../db-utils';
import { logger } from '../logger';
import { ESCALATION_LOCK_TIMEOUT_MS } from '../config';
import type { NotificationChannel } from '../notifications';
import {
  escalationOutcomeForError,
  escalationStateIsAuthoritative,
  type EscalationExecutionResult,
} from './types';
import {
  EscalationInfrastructureError,
  resolveEscalationTargetDetailed,
  type EscalationTargetResolution,
} from './target-resolution';
import { selectEscalationAssignment, type EscalationAssignment } from './assignee-selection';

export * from './types';
export {
  EscalationInfrastructureError,
  resolveEscalationTarget,
  resolveEscalationTargetDetailed,
  type EscalationTargetResolution,
} from './target-resolution';
export { selectEscalationAssignment, type EscalationAssignment } from './assignee-selection';

function escalationWorkerInvalidated(
  currentLock: Date | null | undefined,
  workerToken: Date
): boolean {
  // Production selects always include this field. `undefined` is tolerated for
  // partial test doubles and older adapters; a persisted NULL explicitly means
  // a lifecycle transition invalidated the worker generation.
  if (currentLock === null) return true;
  return currentLock instanceof Date && currentLock.getTime() !== workerToken.getTime();
}

function assignmentUpdateData(assignment: EscalationAssignment): Prisma.IncidentUpdateInput {
  // assigneeId and teamId are mutually exclusive at the database level, so
  // every assignment write must explicitly clear the other side.
  return assignment.type === 'TEAM'
    ? { team: { connect: { id: assignment.teamId } }, assignee: { disconnect: true } }
    : { assignee: { connect: { id: assignment.userId } }, team: { disconnect: true } };
}

function supersededEscalationResult(): EscalationExecutionResult {
  return {
    outcome: 'SUPERSEDED',
    escalated: false,
    reason: 'Escalation superseded by lifecycle transition',
  } as const;
}

/**
 * Execute escalation policy for an incident.
 * Handles multiple steps with delays and different target types.
 */
export async function executeEscalation(
  incidentId: string,
  stepIndex?: number
): Promise<EscalationExecutionResult> {
  const lockTimeoutMs = ESCALATION_LOCK_TIMEOUT_MS;
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      service: {
        include: {
          policy: {
            include: {
              steps: {
                include: {
                  targetUser: true,
                  targetTeam: true,
                  targetSchedule: true,
                },
                orderBy: { stepOrder: 'asc' },
              },
            },
          },
        },
      },
    },
  });

  if (!incident) {
    return { outcome: 'NO_INCIDENT', escalated: false, reason: 'Incident not found' };
  }

  if (!incident.service.policy?.steps?.length) {
    // Clear escalation status if no policy
    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        escalationStatus: null,
        nextEscalationAt: null,
        currentEscalationStep: null,
        escalationProcessingAt: null,
      },
    });
    return { outcome: 'NO_POLICY', escalated: false, reason: 'No escalation policy configured' };
  }

  // Check if escalation is already completed - prevent re-triggering
  if (incident.escalationStatus === 'COMPLETED') {
    return { outcome: 'COMPLETED', escalated: false, reason: 'Escalation already completed' };
  }

  const policy = incident.service.policy;
  const policySteps = policy.steps;

  // Use provided stepIndex, or currentEscalationStep from DB, or default to 0
  const currentStepIndex = stepIndex ?? incident.currentEscalationStep ?? 0;

  if (currentStepIndex >= policySteps.length) {
    // Check how many times this escalation has looped
    const loopEventsCount =
      typeof prisma.incidentEvent?.count === 'function'
        ? await prisma.incidentEvent.count({
            where: {
              incidentId,
              message: { contains: 'Looping back to Step 1' },
            },
          })
        : 0;

    const MAX_LOOPS = 2; // Allow up to 2 retry cycles
    if (loopEventsCount < MAX_LOOPS && incident.status === 'OPEN' && !incident.acknowledgedAt) {
      const cooldownMinutes = 15;
      const nextAt = new Date(Date.now() + cooldownMinutes * 60 * 1000);
      await prisma.incident.update({
        where: { id: incidentId },
        data: {
          escalationStatus: 'ESCALATING',
          nextEscalationAt: nextAt,
          currentEscalationStep: 0,
          escalationGeneration: { increment: 1 },
          escalationProcessingAt: null,
        },
      });

      if (typeof prisma.incidentEvent?.create === 'function') {
        await prisma.incidentEvent.create({
          data: {
            incidentId,
            type: 'ESCALATED',
            message: `Escalation policy completed all ${policySteps.length} step(s). Looping back to Step 1 in ${cooldownMinutes} minutes (Cycle ${loopEventsCount + 1}/${MAX_LOOPS}).`,
          },
        });
      }

      return {
        outcome: 'STEP_SCHEDULED',
        escalated: true,
        reason: `Looping back to Step 1 after cooldown (Cycle ${loopEventsCount + 1})`,
        nextEscalationAt: nextAt,
      };
    }

    // Mark escalation as completed
    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        escalationStatus: 'COMPLETED',
        nextEscalationAt: null,
        currentEscalationStep: null,
        escalationProcessingAt: null,
      },
    });

    try {
      if (typeof prisma.incidentEvent?.create === 'function') {
        await prisma.incidentEvent.create({
          data: {
            incidentId,
            type: 'ESCALATED',
            message: `Escalation policy exhausted: all ${policySteps.length} step(s) completed without acknowledgment.`,
          },
        });
      }
    } catch (_) {}

    return { outcome: 'COMPLETED', escalated: false, reason: 'All escalation steps exhausted' };
  }

  const now = new Date();
  const step = policySteps.find((_, index) => index === currentStepIndex);
  if (!step) {
    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        escalationStatus: 'COMPLETED',
        nextEscalationAt: null,
        currentEscalationStep: null,
        escalationProcessingAt: null,
      },
    });
    return { outcome: 'STEP_MISSING', escalated: false, reason: 'Escalation step not found' };
  }

  const stepDelayMs = (step.delayMinutes || 0) * 60 * 1000;
  if (stepDelayMs > 0) {
    const scheduledAt = incident.nextEscalationAt;
    if (!scheduledAt) {
      const nextRunAt = new Date(now.getTime() + stepDelayMs);
      await prisma.incident.update({
        where: { id: incidentId },
        data: {
          escalationStatus: 'ESCALATING',
          currentEscalationStep: currentStepIndex,
          nextEscalationAt: nextRunAt,
          escalationProcessingAt: null,
        },
      });

      await prisma.incidentEvent.create({
        data: {
          incidentId,
          message: `Escalation scheduled for [[scheduledAt=${nextRunAt.toISOString()}]] (${step.delayMinutes} minute delay)`,
        },
      });

      try {
        const { scheduleEscalation } = await import('../jobs/queue');
        await scheduleEscalation(incidentId, currentStepIndex, stepDelayMs);
      } catch (error) {
        logger.error('Failed to schedule initial escalation job', {
          incidentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      return { outcome: 'STEP_SCHEDULED', escalated: false, reason: 'Escalation scheduled' };
    }

    if (scheduledAt.getTime() > now.getTime()) {
      return { outcome: 'STEP_SCHEDULED', escalated: false, reason: 'Escalation scheduled' };
    }

    // scheduledAt is due; continue to execute without rescheduling.
  }

  const lockCutoff = new Date(now.getTime() - lockTimeoutMs);
  const stepMatch =
    currentStepIndex === 0
      ? { OR: [{ currentEscalationStep: null }, { currentEscalationStep: 0 }] }
      : { currentEscalationStep: currentStepIndex };
  const statusMatch =
    currentStepIndex === 0
      ? { OR: [{ escalationStatus: null }, { escalationStatus: 'ESCALATING' }] }
      : { escalationStatus: 'ESCALATING' };

  const claim = await prisma.incident.updateMany({
    where: {
      id: incidentId,
      status: 'OPEN',
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
      currentEscalationStep: currentStepIndex,
      escalationProcessingAt: now,
    },
  });

  if (claim.count === 0) {
    return {
      outcome: 'ALREADY_CLAIMED',
      escalated: false,
      reason: 'Escalation already in progress',
    };
  }

  // The claim timestamp is also the lifecycle-generation token. Any real
  // lifecycle transition clears escalationProcessingAt; a timed-out reclaim
  // replaces it. Either event makes this worker stale before it can continue.
  const workerToken = now;

  // Resolve target based on target type
  let targetId: string | null = null;
  let targetName: string = 'Unknown';

  switch (step.targetType) {
    case 'USER':
      targetId = step.targetUserId || null;
      targetName = step.targetUser?.name || 'Unknown User';
      break;
    case 'TEAM':
      targetId = step.targetTeamId || null;
      targetName = step.targetTeam?.name || 'Unknown Team';
      break;
    case 'SCHEDULE':
      targetId = step.targetScheduleId || null;
      targetName = step.targetSchedule?.name || 'Unknown Schedule';
      break;
  }

  if (!targetId) {
    const errorMessage = `Escalation step ${currentStepIndex + 1} has invalid target configuration (${step.targetType} with no target ID).`;
    logger.error('Escalation step has invalid target', {
      incidentId,
      stepIndex: currentStepIndex,
      targetType: step.targetType,
      targetUserId: step.targetUserId,
      targetTeamId: step.targetTeamId,
      targetScheduleId: step.targetScheduleId,
    });

    const isLastStep = currentStepIndex >= policySteps.length - 1;

    await runSerializableTransaction(async tx => {
      await tx.incidentEvent.create({
        data: {
          incidentId,
          message:
            errorMessage +
            (isLastStep ? ' Escalation failed: target is unavailable.' : ' Skipping to next step.'),
        },
      });

      if (isLastStep) {
        await tx.incident.update({
          where: { id: incidentId },
          data: {
            escalationStatus: 'FAILED',
            nextEscalationAt: null,
            escalationProcessingAt: null,
            currentEscalationStep: null,
          },
        });
      } else {
        await tx.incident.update({
          where: { id: incidentId },
          data: {
            currentEscalationStep: currentStepIndex + 1,
            nextEscalationAt: null,
            escalationProcessingAt: null,
          },
        });
      }
    });

    // Try next step
    if (!isLastStep) {
      const { scheduleEscalation } = await import('../jobs/queue');
      await scheduleEscalation(incidentId, currentStepIndex + 1, 0);
      return { outcome: 'STEP_SCHEDULED', escalated: false, reason: 'Escalation scheduled' };
    }
    return { outcome: 'INVALID_TARGET', escalated: false, reason: 'Invalid target configuration' };
  }

  // One central contract resolves the audience. An unusable target and an
  // uncovered one are distinguishable; a database failure throws instead of
  // masquerading as "nobody is on call".
  let resolution: EscalationTargetResolution;
  try {
    resolution = await resolveEscalationTargetDetailed({
      targetType: step.targetType,
      targetId,
      at: new Date(),
      notifyOnlyTeamLead: step.notifyOnlyTeamLead || false,
    });
  } catch (error) {
    if (!(error instanceof EscalationInfrastructureError)) throw error;
    // Release the claim so the retry is not blocked until the lock times out.
    try {
      await prisma.incident.updateMany({
        where: { id: incidentId },
        data: { escalationProcessingAt: null },
      });
    } catch {
      // The lock timeout is the backstop if even this write cannot land.
    }
    logger.error('escalation.target.resolution_failed', {
      incidentId,
      stepIndex: currentStepIndex,
      targetType: step.targetType,
      targetId,
      error: error.cause instanceof Error ? error.cause.message : String(error.cause ?? ''),
    });
    throw error;
  }

  if (resolution.outcome !== 'INVALID_TARGET') {
    targetName = resolution.targetName;
  }
  const targetUserIds = resolution.outcome === 'RESOLVED' ? [...resolution.userIds] : [];

  const manualAssigneeId = incident.assigneeId;
  if (currentStepIndex === 0 && manualAssigneeId && !targetUserIds.includes(manualAssigneeId)) {
    targetUserIds.push(manualAssigneeId);
  }

  const assignment = selectEscalationAssignment({
    incidentId,
    generation: incident.escalationGeneration ?? 0,
    stepIndex: currentStepIndex,
    targetType: step.targetType,
    targetId,
    userIds: targetUserIds,
  });

  // Assign the incident immediately when the escalation step runs (before notifications),
  // but only while this worker still owns the generation it atomically claimed.
  const assignmentGenerationIsCurrent = await runSerializableTransaction(async tx => {
    const currentIncident = await tx.incident.findUnique({
      where: { id: incidentId },
      select: { assigneeId: true, teamId: true, escalationProcessingAt: true },
    });

    if (
      !currentIncident ||
      escalationWorkerInvalidated(currentIncident.escalationProcessingAt, workerToken)
    ) {
      return false;
    }

    if (currentIncident.assigneeId || currentIncident.teamId) {
      return true;
    }

    if (assignment) {
      await tx.incident.update({
        where: { id: incidentId },
        data: assignmentUpdateData(assignment),
      });
    }

    return true;
  });

  if (!assignmentGenerationIsCurrent) {
    return supersededEscalationResult();
  }

  if (targetUserIds.length === 0) {
    // An unusable target and an uncovered one both stop this step, but they are
    // different operator problems and must not share one timeline message.
    const invalidTarget = resolution.outcome === 'INVALID_TARGET' ? resolution : null;
    const errorMessage = invalidTarget
      ? `Escalation step ${currentStepIndex + 1} (${step.targetType}) has an unusable target: ${invalidTarget.reason}.`
      : `Escalation step ${currentStepIndex + 1} (${step.targetType}: ${targetName}) resolved to no users.`;
    logger.warn(invalidTarget ? 'escalation.target.invalid' : 'escalation.target.empty', {
      incidentId,
      stepIndex: currentStepIndex,
      targetType: step.targetType,
      targetId,
      targetName,
      reason: invalidTarget?.reason,
    });

    const isLastStep = currentStepIndex >= policySteps.length - 1;

    await runSerializableTransaction(async tx => {
      await tx.incidentEvent.create({
        data: {
          incidentId,
          message:
            errorMessage +
            (isLastStep
              ? invalidTarget
                ? ' Escalation failed: target is unavailable.'
                : ' Escalation failed: no reachable responders.'
              : ' Skipping to next step.'),
        },
      });

      if (isLastStep) {
        await tx.incident.update({
          where: { id: incidentId },
          data: {
            escalationStatus: 'FAILED',
            nextEscalationAt: null,
            escalationProcessingAt: null,
            currentEscalationStep: null,
          },
        });
      } else {
        await tx.incident.update({
          where: { id: incidentId },
          data: {
            currentEscalationStep: currentStepIndex + 1,
            nextEscalationAt: null,
            escalationProcessingAt: null,
          },
        });
      }
    });

    // Try next step
    if (!isLastStep) {
      const { scheduleEscalation } = await import('../jobs/queue');
      await scheduleEscalation(incidentId, currentStepIndex + 1, 0);
      return { outcome: 'STEP_SCHEDULED', escalated: false, reason: 'Escalation scheduled' };
    }
    return invalidTarget
      ? { outcome: 'INVALID_TARGET', escalated: false, reason: invalidTarget.reason }
      : { outcome: 'NO_ELIGIBLE_RESPONDERS', escalated: false, reason: 'No users to notify' };
  }

  // Use escalation-step channels when configured, intersected with each
  // recipient's enabled channels by sendUserNotification.
  const { sendUserNotification } = await import('../user-notifications');
  const notificationsSent = [];
  const escalationChannels: NotificationChannel[] | undefined =
    step.notificationChannels.length > 0 ? step.notificationChannels : undefined;
  const escalationEventKey = [
    'ESCALATION',
    incidentId,
    policy.id,
    String(incident.escalationGeneration ?? 0),
    String(currentStepIndex),
  ].join(':');

  for (const userId of targetUserIds) {
    try {
      const latestState = await prisma.incident.findUnique({
        where: { id: incidentId },
        select: { status: true, escalationStatus: true, escalationProcessingAt: true },
      });
      if (
        !latestState ||
        !['OPEN'].includes(latestState.status) ||
        latestState.escalationStatus === 'COMPLETED' ||
        escalationWorkerInvalidated(latestState.escalationProcessingAt, workerToken)
      ) {
        return supersededEscalationResult();
      }
      const message = `[OpsKnight] Incident: ${incident.title}${currentStepIndex > 0 ? ` (Escalation Level ${currentStepIndex + 1})` : ''}`;
      const result = await sendUserNotification(incidentId, userId, message, escalationChannels, {
        eventKey: escalationEventKey,
      });
      notificationsSent.push({ userId, result });
    } catch (err) {
      logger.error('Failed to send escalation notification to user', {
        incidentId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      notificationsSent.push({
        userId,
        result: {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown notification failure',
        },
      });
    }
  }

  // Create event message
  const targetDescription =
    step.targetType === 'USER'
      ? targetName
      : `${step.targetType}: ${targetName} (${targetUserIds.length} user${targetUserIds.length !== 1 ? 's' : ''})`;

  // Determine next escalation step and schedule it
  const nextStepIndex = currentStepIndex + 1;
  const nextStep =
    nextStepIndex < policySteps.length
      ? (policySteps.find((_, index) => index === nextStepIndex) ?? null)
      : null;
  let nextEscalationAt: Date | null = null;
  let escalationStatus: string = nextStep ? 'ESCALATING' : 'COMPLETED';
  let nextStepMessage: string | null = null;

  if (nextStep) {
    const delayMs = nextStep.delayMinutes * 60 * 1000;
    nextEscalationAt = new Date(Date.now() + delayMs);
    escalationStatus = 'ESCALATING';
    nextStepMessage = `Next escalation step scheduled for [[scheduledAt=${nextEscalationAt.toISOString()}]] (${nextStep.delayMinutes} minute delay)`;
  }

  let shouldScheduleNextJob = Boolean(nextStep && nextEscalationAt);

  const finalGenerationIsCurrent = await runSerializableTransaction(async tx => {
    // Check current state from database to avoid race conditions
    const currentIncident = await tx.incident.findUnique({
      where: { id: incidentId },
      select: {
        assigneeId: true,
        teamId: true,
        status: true,
        escalationStatus: true,
        escalationProcessingAt: true,
      },
    });

    if (
      !currentIncident ||
      escalationWorkerInvalidated(currentIncident.escalationProcessingAt, workerToken)
    ) {
      shouldScheduleNextJob = false;
      return false;
    }

    // Race condition guard: If the incident was acknowledged, resolved, snoozed, or suppressed while notifications
    // were being dispatched, do NOT schedule further escalation steps or overwrite to ESCALATING.
    const isStopped =
      currentIncident.status === 'ACKNOWLEDGED' ||
      currentIncident.status === 'RESOLVED' ||
      currentIncident.escalationStatus === 'COMPLETED';

    const isPaused =
      currentIncident.status === 'SNOOZED' ||
      currentIncident.status === 'SUPPRESSED' ||
      currentIncident.escalationStatus === 'PAUSED';

    const finalEscalationStatus = isStopped ? 'COMPLETED' : isPaused ? 'PAUSED' : escalationStatus;

    const finalNextEscalationAt = isStopped || isPaused ? null : nextEscalationAt;
    const finalStep =
      isStopped || isPaused || nextStepIndex >= policySteps.length ? null : nextStepIndex;

    if (finalEscalationStatus !== 'ESCALATING' || !finalNextEscalationAt) {
      shouldScheduleNextJob = false;
    }

    const updateData: Prisma.IncidentUpdateInput = {
      currentEscalationStep: finalStep,
      nextEscalationAt: finalNextEscalationAt,
      escalationStatus: finalEscalationStatus,
      escalationProcessingAt: null,
    };

    // Ownership comes from the one selector, so this step cannot hand the
    // incident to a different responder than it did before dispatching pages.
    if (!currentIncident.assigneeId && !currentIncident.teamId && assignment) {
      Object.assign(updateData, assignmentUpdateData(assignment));
    }

    await tx.incident.update({
      where: { id: incidentId },
      data: updateData,
    });

    if (!isStopped && !isPaused) {
      await tx.incidentEvent.create({
        data: {
          incidentId,
          type: 'ESCALATED',
          message: `Escalated to ${targetDescription} (Level ${currentStepIndex + 1}${step.delayMinutes > 0 ? `, after ${step.delayMinutes} minute delay` : ''})`,
        },
      });
    }

    if (nextStepMessage && !isStopped && !isPaused) {
      await tx.incidentEvent.create({
        data: {
          incidentId,
          type: 'ESCALATED',
          message: nextStepMessage,
        },
      });
    }

    return true;
  });

  if (!finalGenerationIsCurrent) {
    return supersededEscalationResult();
  }

  // Schedule next escalation step using PostgreSQL job queue
  if (shouldScheduleNextJob && nextStep && nextEscalationAt) {
    const delayMs = (nextStep.delayMinutes || 0) * 60 * 1000;
    if (delayMs === 0) {
      const { scheduleEscalation } = await import('../jobs/queue');
      await scheduleEscalation(incidentId, nextStepIndex, 0);
      return {
        outcome: 'STEP_EXECUTED',
        escalated: true,
        targetName,
        targetType: step.targetType,
        targetCount: targetUserIds.length,
        stepIndex: currentStepIndex,
        notifications: notificationsSent,
        nextStepScheduled: true,
      };
    }
    try {
      const { scheduleEscalation } = await import('../jobs/queue');
      await scheduleEscalation(incidentId, nextStepIndex, delayMs);
    } catch (error) {
      logger.error('Failed to schedule escalation job', {
        incidentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Continue anyway - internal worker will pick it up via nextEscalationAt
    }
  }

  return {
    outcome: 'STEP_EXECUTED',
    escalated: true,
    targetName,
    targetType: step.targetType,
    targetCount: targetUserIds.length,
    stepIndex: currentStepIndex,
    notifications: notificationsSent,
    nextStepScheduled: nextStepIndex < policySteps.length,
  };
}

/**
 * Check and execute pending escalations
 * This should be called periodically (e.g., via cron job) to process delayed escalations
 */
export async function processPendingEscalations(
  executorOrLimit:
    | ((incidentId: string, stepIndex?: number) => Promise<EscalationExecutionResult>)
    | number = executeEscalation
): Promise<{ processed: number; total: number; errors?: string[] }> {
  const executor = typeof executorOrLimit === 'function' ? executorOrLimit : executeEscalation;
  const limit = typeof executorOrLimit === 'number' ? executorOrLimit : 50;
  const errors: string[] = [];
  let processed = 0;
  const lockTimeoutMs = ESCALATION_LOCK_TIMEOUT_MS;

  try {
    const lockCutoff = new Date(Date.now() - lockTimeoutMs);

    // Find incidents that need escalation
    const pendingIncidents = await prisma.incident.findMany({
      where: {
        status: 'OPEN',
        escalationStatus: 'ESCALATING',
        nextEscalationAt: {
          lte: new Date(),
        },
        OR: [{ escalationProcessingAt: null }, { escalationProcessingAt: { lt: lockCutoff } }],
      },
      select: {
        id: true,
        currentEscalationStep: true,
      },
      take: limit,
      orderBy: {
        nextEscalationAt: 'asc',
      },
    });

    const total = pendingIncidents.length;

    // Process all pending escalations concurrently
    const escalationPromises = pendingIncidents.map(async incident => {
      // executeEscalation owns the single atomic per-incident claim. Pre-claiming
      // here would make the executor reject its own fresh lock and strand the
      // orphaned escalation until every lock timeout.
      const stepIndex = incident.currentEscalationStep ?? 0;
      const result = await executor(incident.id, stepIndex);
      return { incident, result };
    });

    const settledResults = await Promise.allSettled(escalationPromises);

    for (const settledResult of settledResults) {
      if (settledResult.status === 'rejected') {
        errors.push(settledResult.reason?.message || 'Unknown error');
        continue;
      }

      const { incident, result } = settledResult.value;

      try {
        if (result.escalated) {
          processed++;
        } else {
          // executeEscalation persists terminal states itself (including FAILED),
          // or intentionally no-ops when a newer lifecycle generation supersedes
          // the worker. Do not overwrite either authoritative state here.
          if (escalationStateIsAuthoritative(result.outcome)) continue;

          await prisma.incident.update({
            where: { id: incident.id },
            data: {
              escalationStatus: 'ESCALATING',
              nextEscalationAt: new Date(Date.now() + 30000),
              escalationProcessingAt: null,
            },
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isRetryable = escalationOutcomeForError(error) === 'RETRYABLE_FAILURE';

        logger.error('Error processing escalation', {
          incidentId: incident.id,
          error: errorMessage,
          isRetryable,
        });
        errors.push(`Incident ${incident.id}: ${errorMessage}`);

        try {
          if (!isRetryable) {
            await prisma.incident.update({
              where: { id: incident.id },
              data: {
                escalationStatus: 'FAILED',
                nextEscalationAt: null,
                escalationProcessingAt: null,
              },
            });

            await prisma.incidentEvent
              .create({
                data: {
                  incidentId: incident.id,
                  message: `Escalation processing failed (FATAL): ${errorMessage}`,
                },
              })
              .catch(() => {});
          } else {
            await prisma.incident.update({
              where: { id: incident.id },
              data: { escalationProcessingAt: null },
            });
            logger.warn('Escalation failed with retryable error, releasing lock', {
              incidentId: incident.id,
            });
          }
        } catch (updateError) {
          logger.error('Failed to update incident after escalation error', {
            incidentId: incident.id,
            updateError: updateError instanceof Error ? updateError.message : 'Unknown error',
          });
        }
      }
    }

    return {
      processed,
      total,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in processPendingEscalations batch loop', { error: errorMessage });
    return {
      processed,
      total: 0,
      errors: [errorMessage],
    };
  }
}
