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
  deliverEscalationNotificationIntents,
  planEscalationNotificationIntents,
  type EscalationNotificationPlan,
} from './notification-intents';
import {
  claimEscalationStep,
  commitEscalationPlan,
  finalizeEscalationExecution,
  releaseEscalationClaim,
  scheduleDelayedEscalationStep,
} from './repository';
import { settleEscalationFallbackOutcome } from './fallback-repository';

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

export interface ExecuteEscalationOptions {
  generation?: number;
}

/**
 * Executes one escalation step. The executor only orchestrates reads and domain
 * decisions; all durable escalation state transitions live behind repository
 * contracts.
 */
export async function executeEscalation(
  incidentId: string,
  stepIndex?: number,
  options: ExecuteEscalationOptions = {}
): Promise<EscalationExecutionResult> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      assignee: true,
      team: true,
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
  const generation = incident.escalationGeneration ?? 0;
  const currentStepIndex = stepIndex ?? incident.currentEscalationStep ?? 0;

  if (policySteps.length === 0) {
    const finalized = await finalizeEscalationExecution({
      incidentId,
      expectedGeneration: generation,
      expectedStep: currentStepIndex,
      status: null,
    });
    if (!finalized) return supersededEscalationResult();
    return { outcome: 'NO_POLICY', escalated: false, reason: 'No escalation policy configured' };
  }

  if (incident.escalationStatus === 'COMPLETED') {
    return { outcome: 'COMPLETED', escalated: false, reason: 'Escalation already completed' };
  }

  if (options.generation !== undefined && options.generation !== generation) {
    logger.info('escalation.execution.superseded', {
      incidentId,
      jobGeneration: options.generation,
      currentGeneration: generation,
    });
    return supersededEscalationResult();
  }

  if (escalationPolicyExhausted(currentStepIndex, policySteps.length)) {
    const finalized = await finalizeEscalationExecution({
      incidentId,
      expectedGeneration: generation,
      expectedStep: currentStepIndex,
      status: 'COMPLETED',
      timelineMessage: `Escalation policy exhausted: all ${policySteps.length} step(s) completed without acknowledgment.`,
    });
    if (!finalized) return supersededEscalationResult();
    return { outcome: 'COMPLETED', escalated: false, reason: 'All escalation steps exhausted' };
  }

  const step = policySteps.at(currentStepIndex);
  if (!step) {
    const finalized = await finalizeEscalationExecution({
      incidentId,
      expectedGeneration: generation,
      expectedStep: currentStepIndex,
      status: 'COMPLETED',
    });
    if (!finalized) return supersededEscalationResult();
    return { outcome: 'STEP_MISSING', escalated: false, reason: 'Escalation step not found' };
  }

  const now = new Date();
  const stepDelayMinutes = step.delayMinutes || 0;

  if (stepDelayMinutes > 0) {
    if (!incident.nextEscalationAt) {
      const dueAt = escalationDueAt(now, stepDelayMinutes);
      const scheduled = await scheduleDelayedEscalationStep({
        incidentId,
        generation,
        stepIndex: currentStepIndex,
        delayMinutes: stepDelayMinutes,
        dueAt,
      });
      if (!scheduled) return supersededEscalationResult();
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

  try {
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
      extraRecipients:
        currentStepIndex === 0 && incident.assigneeId && incident.assignee?.status === 'ACTIVE'
          ? [incident.assigneeId]
          : undefined,
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
    }

    const eventKey = [
      'ESCALATION',
      incidentId,
      policy!.id,
      String(generation),
      String(currentStepIndex),
    ].join(':');

    let notificationPlan: EscalationNotificationPlan | undefined;
    if (recipients.length > 0) {
      notificationPlan = await planEscalationNotificationIntents({
        incident,
        recipients,
        stepChannels: step.notificationChannels.length > 0 ? step.notificationChannels : undefined,
        eventKey,
        displayMessage: `[OpsKnight] Incident: ${incident.title}${
          currentStepIndex > 0 ? ` (Escalation Level ${currentStepIndex + 1})` : ''
        }`,
        generation,
        stepIndex: currentStepIndex,
      });
    }

    const commit = await commitEscalationPlan({
      incidentId,
      generation,
      expectedStep: currentStepIndex,
      workerToken,
      plan,
      notifications: notificationPlan,
    });

    if (!commit.committed) return supersededEscalationResult();

    const notifications = notificationPlan
      ? await deliverEscalationNotificationIntents(notificationPlan)
      : [];

    logger.info('escalation.plan.committed', {
      incidentId,
      generation,
      stepIndex: currentStepIndex,
      targetType: step.targetType,
      targetId,
      recipientCount: recipients.length,
      intentsCreated: commit.intentsCreated,
      unreachableRecipients: notificationPlan?.unreachableUserIds.length ?? 0,
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
  } catch (error) {
    await releaseEscalationClaim(incidentId, workerToken);
    throw error;
  }
}

/**
 * State-driven recovery scan for delayed escalation. The scanner owns no
 * escalation mutations: every retry/terminal decision is generation-fenced by
 * the fallback repository contract.
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
  const lockCutoff = new Date(Date.now() - ESCALATION_LOCK_TIMEOUT_MS);

  try {
    const pendingIncidents = await prisma.incident.findMany({
      where: {
        status: 'OPEN',
        escalationStatus: 'ESCALATING',
        nextEscalationAt: { lte: new Date() },
        OR: [{ escalationProcessingAt: null }, { escalationProcessingAt: { lt: lockCutoff } }],
      },
      select: {
        id: true,
        currentEscalationStep: true,
        escalationGeneration: true,
      },
      take: limit,
      orderBy: { nextEscalationAt: 'asc' },
    });

    const total = pendingIncidents.length;
    const settledResults = await Promise.all(
      pendingIncidents.map(async incident => {
        const stepIndex = incident.currentEscalationStep ?? 0;
        try {
          return { incident, result: await executor(incident.id, stepIndex) } as const;
        } catch (error) {
          return { incident, error } as const;
        }
      })
    );

    for (const settledResult of settledResults) {
      const { incident } = settledResult;
      try {
        if ('error' in settledResult) throw settledResult.error;
        const { result } = settledResult;
        if (result.escalated) {
          processed++;
          continue;
        }

        if (escalationStateIsAuthoritative(result.outcome)) continue;

        await settleEscalationFallbackOutcome({
          incidentId: incident.id,
          expectedGeneration: incident.escalationGeneration ?? 0,
          expectedStep: incident.currentEscalationStep,
          disposition: {
            kind: 'RETRY_SCHEDULED',
            retryAt: new Date(Date.now() + 30_000),
          },
        });
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
          await settleEscalationFallbackOutcome({
            incidentId: incident.id,
            expectedGeneration: incident.escalationGeneration ?? 0,
            expectedStep: incident.currentEscalationStep,
            disposition: isRetryable
              ? { kind: 'RETRYABLE_FAILURE' }
              : { kind: 'TERMINAL_FAILURE', message: errorMessage },
          });
          if (isRetryable) {
            logger.warn('Escalation failed with retryable error, releasing lock', {
              incidentId: incident.id,
            });
          }
        } catch (updateError) {
          logger.error('Failed to settle incident after escalation error', {
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
    return { processed, total: 0, errors: [errorMessage] };
  }
}
