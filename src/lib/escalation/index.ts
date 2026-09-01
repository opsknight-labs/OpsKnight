import prisma from '../prisma';
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
import { planEscalationStep, type EscalationPlan } from './planner';
import { escalationDueAt, escalationPolicyExhausted } from './state';
import {
  applyPlannedAssignment,
  claimEscalationStep,
  commitEscalationPlan,
  escalationGenerationStillOwned,
  finalizeEscalationExecution,
  releaseEscalationClaim,
  scheduleDelayedEscalationStep,
  type EscalationWorkerToken,
} from './repository';

export * from './types';
export * from './state';
export {
  EscalationInfrastructureError,
  resolveEscalationTarget,
  resolveEscalationTargetDetailed,
  type EscalationTargetResolution,
} from './target-resolution';
export { selectEscalationAssignment, type EscalationAssignment } from './assignee-selection';
export { planEscalationStep, type EscalationPlan } from './planner';

type PolicyStepRow = {
  delayMinutes: number;
  targetType: 'USER' | 'TEAM' | 'SCHEDULE';
  targetUserId: string | null;
  targetTeamId: string | null;
  targetScheduleId: string | null;
  notifyOnlyTeamLead: boolean;
  notificationChannels: NotificationChannel[];
};

function supersededEscalationResult(): EscalationExecutionResult {
  return {
    outcome: 'SUPERSEDED',
    escalated: false,
    reason: 'Escalation superseded by lifecycle transition',
  };
}

/** The target ID a step points at, or null when its configuration is unusable. */
function stepTargetId(step: PolicyStepRow): string | null {
  switch (step.targetType) {
    case 'USER':
      return step.targetUserId || null;
    case 'TEAM':
      return step.targetTeamId || null;
    case 'SCHEDULE':
      return step.targetScheduleId || null;
    default:
      return null;
  }
}

/**
 * Dispatches this step's responder pages, re-checking generation ownership
 * before each one so a lifecycle transition stops the fan-out immediately.
 *
 * Individual delivery failures are recorded and do not block the step's state
 * from committing: whether a provider accepted a message is the notification
 * control plane's problem, not a reason to lose escalation progress.
 */
async function dispatchStepNotifications(input: {
  incidentId: string;
  incidentTitle: string;
  stepIndex: number;
  eventKey: string;
  channels: NotificationChannel[] | undefined;
  recipients: readonly string[];
  workerToken: EscalationWorkerToken;
  generation: number;
}): Promise<{ superseded: boolean; notifications: unknown[] }> {
  const { sendUserNotification } = await import('../user-notifications');
  const notifications: unknown[] = [];
  const message = `[OpsKnight] Incident: ${input.incidentTitle}${
    input.stepIndex > 0 ? ` (Escalation Level ${input.stepIndex + 1})` : ''
  }`;

  for (const userId of input.recipients) {
    if (
      !(await escalationGenerationStillOwned(input.incidentId, input.workerToken, input.generation))
    ) {
      return { superseded: true, notifications };
    }
    try {
      const result = await sendUserNotification(input.incidentId, userId, message, input.channels, {
        eventKey: input.eventKey,
      });
      notifications.push({ userId, result });
    } catch (error) {
      logger.error('Failed to send escalation notification to user', {
        incidentId: input.incidentId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      notifications.push({
        userId,
        result: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown notification failure',
        },
      });
    }
  }

  return { superseded: false, notifications };
}

/**
 * Executes one escalation step for an incident:
 *
 *   load -> guard -> claim -> resolve -> plan -> page -> commit
 *
 * The planner decides every transition and the repository commits it in a
 * single transaction, so no branch in here writes escalation state of its own.
 */
export interface ExecuteEscalationOptions {
  /**
   * The lifecycle generation this work was created for, from the job payload.
   * When present it is verified before anything is claimed or paged, so a job
   * left over from a superseded generation self-cancels. Legacy jobs written
   * before generations were carried omit it and cannot be verified; they are
   * allowed through so a rolling deploy does not drop in-flight escalations.
   */
  generation?: number;
}

export async function executeEscalation(
  incidentId: string,
  stepIndex?: number,
  options: ExecuteEscalationOptions = {}
): Promise<EscalationExecutionResult> {
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

  const policy = incident.service.policy;
  const policySteps = (policy?.steps ?? []) as unknown as PolicyStepRow[];

  if (policySteps.length === 0) {
    // A service with no policy carries no escalation state.
    await finalizeEscalationExecution({ incidentId, status: null });
    return { outcome: 'NO_POLICY', escalated: false, reason: 'No escalation policy configured' };
  }

  if (incident.escalationStatus === 'COMPLETED') {
    return { outcome: 'COMPLETED', escalated: false, reason: 'Escalation already completed' };
  }

  const generation = incident.escalationGeneration ?? 0;

  if (options.generation !== undefined && options.generation !== generation) {
    // Refuse before resolving a target or paging anyone: this job belongs to an
    // escalation run the incident has already moved past.
    logger.info('escalation.execution.superseded', {
      incidentId,
      jobGeneration: options.generation,
      currentGeneration: generation,
    });
    return supersededEscalationResult();
  }

  const currentStepIndex = stepIndex ?? incident.currentEscalationStep ?? 0;

  if (escalationPolicyExhausted(currentStepIndex, policySteps.length)) {
    // Policies do not repeat: running out of steps completes the execution.
    await finalizeEscalationExecution({
      incidentId,
      status: 'COMPLETED',
      timelineMessage: `Escalation policy exhausted: all ${policySteps.length} step(s) completed without acknowledgment.`,
    });
    return { outcome: 'COMPLETED', escalated: false, reason: 'All escalation steps exhausted' };
  }

  const step = policySteps.at(currentStepIndex);
  if (!step) {
    await finalizeEscalationExecution({ incidentId, status: 'COMPLETED' });
    return { outcome: 'STEP_MISSING', escalated: false, reason: 'Escalation step not found' };
  }

  const now = new Date();
  const stepDelayMinutes = step.delayMinutes || 0;

  if (stepDelayMinutes > 0) {
    if (!incident.nextEscalationAt) {
      // First sighting of a delayed step: arm the state and its due job together.
      const dueAt = escalationDueAt(now, stepDelayMinutes);
      await scheduleDelayedEscalationStep({
        incidentId,
        generation,
        stepIndex: currentStepIndex,
        delayMinutes: stepDelayMinutes,
        dueAt,
      });
      return {
        outcome: 'STEP_SCHEDULED',
        escalated: false,
        reason: 'Escalation scheduled',
        nextEscalationAt: dueAt,
      };
    }

    if (incident.nextEscalationAt.getTime() > now.getTime()) {
      return {
        outcome: 'STEP_SCHEDULED',
        escalated: false,
        reason: 'Escalation scheduled',
        nextEscalationAt: incident.nextEscalationAt,
      };
    }
    // The step is due; fall through and execute it.
  }

  const claim = await claimEscalationStep({
    incidentId,
    stepIndex: currentStepIndex,
    expectedGeneration: options.generation ?? generation,
    now,
    lockTimeoutMs: ESCALATION_LOCK_TIMEOUT_MS,
  });

  if (!claim.claimed) {
    return claim.reason === 'SUPERSEDED'
      ? supersededEscalationResult()
      : {
          outcome: 'ALREADY_CLAIMED',
          escalated: false,
          reason: 'Escalation already in progress',
        };
  }
  const workerToken = claim.token;

  const targetId = stepTargetId(step);
  let resolution: EscalationTargetResolution = {
    outcome: 'INVALID_TARGET',
    reason: `${step.targetType} step has no target ID configured`,
  };

  if (targetId) {
    try {
      resolution = await resolveEscalationTargetDetailed({
        targetType: step.targetType,
        targetId,
        at: now,
        notifyOnlyTeamLead: step.notifyOnlyTeamLead || false,
      });
    } catch (error) {
      if (!(error instanceof EscalationInfrastructureError)) throw error;
      // Escalation state was not advanced. Release the lease so the retry is
      // not blocked, and let the caller classify this as a retryable failure.
      await releaseEscalationClaim(incidentId, workerToken);
      logger.error('escalation.target.resolution_failed', {
        incidentId,
        stepIndex: currentStepIndex,
        targetType: step.targetType,
        targetId,
        error: error.cause instanceof Error ? error.cause.message : String(error.cause ?? ''),
      });
      throw error;
    }
  }

  const plan: EscalationPlan = planEscalationStep({
    incidentId,
    generation,
    stepIndex: currentStepIndex,
    stepCount: policySteps.length,
    targetType: step.targetType,
    targetId,
    resolution,
    // A hand-assigned owner stays in the first page's audience.
    extraRecipients:
      currentStepIndex === 0 && incident.assigneeId ? [incident.assigneeId] : undefined,
    stepDelayMinutes,
    nextStepDelayMinutes: policySteps.at(currentStepIndex + 1)?.delayMinutes ?? null,
    now,
  });

  const targetName = resolution.outcome === 'INVALID_TARGET' ? 'Unknown' : resolution.targetName;
  const recipients = plan.notificationRecipients;

  if (recipients.length === 0) {
    logger.warn(
      plan.outcome === 'INVALID_TARGET' ? 'escalation.target.invalid' : 'escalation.target.empty',
      {
        incidentId,
        stepIndex: currentStepIndex,
        targetType: step.targetType,
        targetId,
        targetName,
        outcome: plan.outcome,
      }
    );
  } else if (
    !(await applyPlannedAssignment({ incidentId, workerToken, assignment: plan.assignment }))
  ) {
    // Ownership is taken before paging so the page and the boards agree.
    return supersededEscalationResult();
  }

  let notifications: unknown[] = [];
  if (recipients.length > 0) {
    const dispatch = await dispatchStepNotifications({
      incidentId,
      incidentTitle: incident.title,
      stepIndex: currentStepIndex,
      eventKey: [
        'ESCALATION',
        incidentId,
        policy!.id,
        String(generation),
        String(currentStepIndex),
      ].join(':'),
      channels: step.notificationChannels.length > 0 ? step.notificationChannels : undefined,
      recipients,
      workerToken,
      generation,
    });
    if (dispatch.superseded) return supersededEscalationResult();
    notifications = dispatch.notifications;
  }

  const commit = await commitEscalationPlan({
    incidentId,
    generation,
    expectedStep: currentStepIndex,
    workerToken,
    plan,
  });

  if (!commit.committed) return supersededEscalationResult();

  logger.info('escalation.plan.committed', {
    incidentId,
    generation,
    stepIndex: currentStepIndex,
    targetType: step.targetType,
    targetId,
    recipientCount: recipients.length,
    outcome: plan.outcome,
    lifecycleGate: commit.gate,
    appliedStatus: commit.appliedStatus,
    nextStepIndex: plan.nextJob?.stepIndex ?? null,
  });

  if (plan.outcome === 'STEP_EXECUTED') {
    return {
      outcome: 'STEP_EXECUTED',
      escalated: true,
      targetName,
      targetType: step.targetType,
      targetCount: recipients.length,
      stepIndex: currentStepIndex,
      notifications,
      nextStepScheduled: plan.nextJob !== null,
      ...(plan.nextState.nextEscalationAt
        ? { nextEscalationAt: plan.nextState.nextEscalationAt }
        : {}),
    };
  }

  if (plan.outcome === 'STEP_SCHEDULED') {
    return {
      outcome: 'STEP_SCHEDULED',
      escalated: false,
      reason: 'Escalation scheduled',
      stepIndex: currentStepIndex,
      nextStepScheduled: true,
    };
  }

  return {
    outcome: plan.outcome,
    escalated: false,
    reason:
      plan.outcome === 'INVALID_TARGET'
        ? resolution.outcome === 'INVALID_TARGET'
          ? resolution.reason
          : 'Invalid target configuration'
        : 'No users to notify',
    stepIndex: currentStepIndex,
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
