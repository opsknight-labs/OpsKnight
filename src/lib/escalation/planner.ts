/**
 * The single escalation step planner.
 *
 * Given the incident's execution state, the live policy step, the resolved
 * audience, and the current time, it returns one `EscalationPlan` describing
 * everything the step should change. It reads nothing and writes nothing:
 * every branch — paged, uncovered, unusable target, final step, exhausted
 * policy — produces a plan through the same code path, so no branch can
 * invent its own state transition.
 */
import type { EscalationTargetType } from '@prisma/client';
import { selectEscalationAssignment, type EscalationAssignment } from './assignee-selection';
import type { EscalationTargetResolution } from './target-resolution';
import {
  escalationDueAt,
  nextEscalationStepIndex,
  terminalEscalationStatus,
  type EscalationStatus,
} from './state';
import type { EscalationOutcome } from './types';

export interface EscalationTimelineEvent {
  /** Prisma `IncidentEventType`; omitted for plain informational entries. */
  type?: 'ESCALATED';
  message: string;
}

export interface EscalationPlan {
  outcome: EscalationOutcome;
  /** The owner this step should take, or null to page without taking ownership. */
  assignment: EscalationAssignment | null;
  notificationRecipients: string[];
  timelineEvents: EscalationTimelineEvent[];
  nextState: {
    status: EscalationStatus;
    currentStep: number | null;
    nextEscalationAt: Date | null;
  };
  nextJob: { stepIndex: number; scheduledAt: Date } | null;
}

export interface EscalationPlanInput {
  incidentId: string;
  generation: number;
  stepIndex: number;
  /** Number of steps in the policy as loaded at execution time. */
  stepCount: number;
  targetType: EscalationTargetType;
  /** Null when the step has no target ID configured for its target type. */
  targetId: string | null;
  resolution: EscalationTargetResolution;
  /**
   * Recipients to page in addition to the resolved target — currently the
   * incident's manual assignee on the first step, so a hand-assigned owner is
   * not left out of the first page. Callers must only pass eligible (ACTIVE)
   * responders, and these never affect whether the step reached anyone.
   */
  extraRecipients?: readonly string[];
  /** Delay of the step that follows this one, or null when this is the last. */
  nextStepDelayMinutes: number | null;
  stepDelayMinutes: number;
  now: Date;
}

function stepLabel(stepIndex: number): string {
  return `Escalation step ${stepIndex + 1}`;
}

function targetDescription(
  targetType: EscalationTargetType,
  targetName: string,
  recipientCount: number
): string {
  if (targetType === 'USER') return targetName;
  return `${targetType}: ${targetName} (${recipientCount} user${recipientCount !== 1 ? 's' : ''})`;
}

/**
 * A step that reached nobody: advance to the next tier if there is one,
 * otherwise park the execution in FAILED. Either way the plan carries the
 * complete next state, so the caller never has to decide.
 */
function planUnreachedStep(
  input: EscalationPlanInput,
  detail: { message: string; terminalSuffix: string; outcome: EscalationOutcome }
): EscalationPlan {
  const nextStepIndex = nextEscalationStepIndex(input.stepIndex, input.stepCount);

  if (nextStepIndex === null) {
    return {
      outcome: detail.outcome,
      assignment: null,
      notificationRecipients: [],
      timelineEvents: [{ message: `${detail.message}${detail.terminalSuffix}` }],
      nextState: {
        status: terminalEscalationStatus(false),
        currentStep: null,
        nextEscalationAt: null,
      },
      nextJob: null,
    };
  }

  // The skipped tier stays visible in `nextEscalationAt` so the reconciliation
  // scanner can rebuild the follow-up job if its row is ever lost.
  return {
    outcome: 'STEP_SCHEDULED',
    assignment: null,
    notificationRecipients: [],
    timelineEvents: [{ message: `${detail.message} Skipping to next step.` }],
    nextState: {
      status: 'ESCALATING',
      currentStep: nextStepIndex,
      nextEscalationAt: input.now,
    },
    nextJob: { stepIndex: nextStepIndex, scheduledAt: input.now },
  };
}

/** Plans one escalation step. Every branch returns a complete plan. */
export function planEscalationStep(input: EscalationPlanInput): EscalationPlan {
  if (input.targetId === null) {
    return planUnreachedStep(input, {
      outcome: 'INVALID_TARGET',
      message: `${stepLabel(input.stepIndex)} has invalid target configuration (${input.targetType} with no target ID).`,
      terminalSuffix: ' Escalation failed: target is unavailable.',
    });
  }

  if (input.resolution.outcome === 'INVALID_TARGET') {
    return planUnreachedStep(input, {
      outcome: 'INVALID_TARGET',
      message: `${stepLabel(input.stepIndex)} (${input.targetType}) has an unusable target: ${input.resolution.reason}.`,
      terminalSuffix: ' Escalation failed: target is unavailable.',
    });
  }

  const targetName = input.resolution.targetName;
  const resolvedUserIds =
    input.resolution.outcome === 'RESOLVED' ? [...input.resolution.userIds] : [];

  // Whether the step reached anyone is decided by its *target* alone. An extra
  // recipient rides along on a step that already works; it must never make an
  // uncovered target look like a successful page, which would let a final tier
  // report COMPLETED with nobody eligible actually paged.
  if (resolvedUserIds.length === 0) {
    return planUnreachedStep(input, {
      outcome: 'NO_ELIGIBLE_RESPONDERS',
      message: `${stepLabel(input.stepIndex)} (${input.targetType}: ${targetName}) resolved to no users.`,
      terminalSuffix: ' Escalation failed: no reachable responders.',
    });
  }

  const recipients = [...new Set([...resolvedUserIds, ...(input.extraRecipients ?? [])])];

  const assignment = selectEscalationAssignment({
    incidentId: input.incidentId,
    generation: input.generation,
    stepIndex: input.stepIndex,
    targetType: input.targetType,
    targetId: input.targetId,
    // Ownership follows the policy's target, never an incidental extra
    // recipient such as a pre-existing manual assignee.
    userIds: resolvedUserIds,
  });

  const timelineEvents: EscalationTimelineEvent[] = [
    {
      type: 'ESCALATED',
      message: `Escalated to ${targetDescription(input.targetType, targetName, recipients.length)} (Level ${
        input.stepIndex + 1
      }${input.stepDelayMinutes > 0 ? `, after ${input.stepDelayMinutes} minute delay` : ''})`,
    },
  ];

  const nextStepIndex = nextEscalationStepIndex(input.stepIndex, input.stepCount);

  if (nextStepIndex === null) {
    // The policy ran to its end. It completes; it does not loop.
    return {
      outcome: 'STEP_EXECUTED',
      assignment,
      notificationRecipients: recipients,
      timelineEvents,
      nextState: {
        status: terminalEscalationStatus(true),
        currentStep: null,
        nextEscalationAt: null,
      },
      nextJob: null,
    };
  }

  const nextEscalationAt = escalationDueAt(input.now, input.nextStepDelayMinutes);
  timelineEvents.push({
    type: 'ESCALATED',
    message: `Next escalation step scheduled for [[scheduledAt=${nextEscalationAt.toISOString()}]] (${
      input.nextStepDelayMinutes ?? 0
    } minute delay)`,
  });

  return {
    outcome: 'STEP_EXECUTED',
    assignment,
    notificationRecipients: recipients,
    timelineEvents,
    nextState: {
      status: 'ESCALATING',
      currentStep: nextStepIndex,
      nextEscalationAt,
    },
    nextJob: { stepIndex: nextStepIndex, scheduledAt: nextEscalationAt },
  };
}
