import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { runSerializableTransaction } from './db-utils';
import { buildScheduleBlocks, getFinalScheduleBlocks } from './oncall';
import { logger } from './logger';
import { ESCALATION_LOCK_TIMEOUT_MS } from './config';
import { startOfDayInTimeZone, startOfNextDayInTimeZone } from './timezone';
import type { NotificationChannel } from './notifications';
// import { formatDateTime } from './timezone'; // Unused

export interface EscalationExecutionResult {
  escalated: boolean;
  reason?: string;
  nextEscalationAt?: Date;
  targetName?: string;
  targetType?: string;
  targetCount?: number;
  stepIndex?: number;
  notifications?: unknown[];
  nextStepScheduled?: boolean;
}

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

function supersededEscalationResult(): EscalationExecutionResult {
  return {
    escalated: false,
    reason: 'Escalation superseded by lifecycle transition',
  } as const;
}

/**
 * Get all active on-call users for a schedule at a given time
 * Returns array of all users who are on-call across all active layers
 */
async function getOnCallUsersForSchedule(scheduleId: string, atTime: Date): Promise<string[]> {
  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: {
      timeZone: true,
      layers: {
        include: {
          users: {
            include: { user: true },
            orderBy: { position: 'asc' },
          },
        },
      },
      overrides: {
        where: {
          start: { lte: atTime },
          end: { gt: atTime },
          user: { status: 'ACTIVE' },
        },
        include: {
          user: true,
        },
      },
    },
  });

  if (!schedule || (schedule.layers.length === 0 && schedule.overrides.length === 0)) {
    return [];
  }

  // Build schedule blocks to find who's on-call
  const windowStart = startOfDayInTimeZone(atTime, schedule.timeZone);
  const windowEnd = startOfNextDayInTimeZone(atTime, schedule.timeZone);

  const layerPriority = new Map<string, number>(
    schedule.layers.map(layer => [
      layer.id,
      (layer as { priority?: number }).priority ?? 100 - ((layer as { order?: number }).order ?? 0),
    ])
  );
  const blocks = buildScheduleBlocks(
    schedule.layers.map(layer => {
      const rotHours =
        (layer as { rotationLengthHours?: number }).rotationLengthHours ??
        ((layer as { shiftDuration?: number }).shiftDuration
          ? (layer as { shiftDuration?: number }).shiftDuration! / 60
          : (layer as { rotationType?: string }).rotationType === 'WEEKLY'
            ? 168
            : 24);

      return {
        id: layer.id,
        name: layer.name,
        start: layer.start,
        end: (layer as { end?: Date | null }).end ?? null,
        rotationLengthHours: rotHours,
        shiftLengthHours: (layer as { shiftLengthHours?: number }).shiftLengthHours ?? rotHours,
        restrictions: layer.restrictions as any,
        priority:
          (layer as { priority?: number }).priority ??
          100 - ((layer as { order?: number }).order ?? 0),
        users: layer.users
          .filter(u => u.user.status === 'ACTIVE')
          .map((u, index) => ({
            userId: u.userId,
            position: (u as { position?: number }).position ?? index,
            user: {
              name: u.user?.name || '',
              avatarUrl: u.user?.avatarUrl,
              gender: u.user?.gender,
            },
          })),
      };
    }),
    schedule.overrides.map(o => ({
      id: o.id,
      userId: o.userId,
      replacesUserId: o.replacesUserId,
      start: o.start,
      end: o.end,
      user: {
        name: o.user.name || '',
        avatarUrl: o.user.avatarUrl,
        gender: o.user.gender,
      },
    })),
    windowStart,
    windowEnd,
    schedule.timeZone
  );

  const finalBlocks = getFinalScheduleBlocks(blocks, layerPriority);

  // Find blocks active at atTime
  const activeBlocks = finalBlocks.filter(
    b => b.start.getTime() <= atTime.getTime() && b.end.getTime() > atTime.getTime()
  );

  const userIds = new Set<string>();
  for (const block of activeBlocks) {
    if (block.userId) {
      userIds.add(block.userId);
    }
  }

  if (userIds.size > 0) {
    return Array.from(userIds);
  }

  // If no active block was found (e.g. coverage gap in schedule), return empty array
  // so escalation logic cleanly advances to the next step or policy tier rather than
  // blasting every user in the entire schedule roster.
  return [];
}

/**
 * Get all users in a team
 * If notifyOnlyTeamLead is true, returns only the team lead
 *
 * OPTIMIZED: Single query instead of 2-3 separate queries
 */
async function getTeamUsers(
  teamId: string,
  notifyOnlyTeamLead: boolean = false
): Promise<string[]> {
  // Single optimized query that gets team + lead + members in one roundtrip
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      teamLeadId: true,
      members: {
        where: {
          receiveTeamNotifications: true,
        },
        select: {
          userId: true,
          user: { select: { status: true } },
        },
      },
    },
  });

  if (!team) return [];

  const activeMembers = team.members.filter(m =>
    (m as { user?: { status?: string } | null }).user
      ? (m as { user?: { status?: string } | null }).user?.status !== 'DISABLED'
      : true
  );

  if (notifyOnlyTeamLead) {
    // Check if team lead exists and has notifications enabled
    if (team.teamLeadId) {
      const leadHasNotifications = activeMembers.some(m => m.userId === team.teamLeadId);
      if (leadHasNotifications) {
        return [team.teamLeadId];
      }
    }
    return [];
  }

  return activeMembers.map(m => m.userId);
}

/**
 * Resolve escalation target to a list of user IDs
 * Supports: User (direct), Team (all members or only lead), Schedule (all active on-call users)
 */
export async function resolveEscalationTarget(
  targetType: 'USER' | 'TEAM' | 'SCHEDULE',
  targetId: string,
  atTime: Date = new Date(),
  notifyOnlyTeamLead: boolean = false
): Promise<string[]> {
  switch (targetType) {
    case 'USER': {
      if (prisma.user?.findUnique) {
        try {
          const user = await prisma.user.findUnique({
            where: { id: targetId },
            select: { id: true, status: true },
          });
          if (!user || user.status === 'DISABLED') {
            return [];
          }
        } catch {
          return [];
        }
      }
      return [targetId];
    }

    case 'TEAM':
      return await getTeamUsers(targetId, notifyOnlyTeamLead);

    case 'SCHEDULE':
      return await getOnCallUsersForSchedule(targetId, atTime);

    default:
      return [];
  }
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
    return { escalated: false, reason: 'Incident not found' };
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
    return { escalated: false, reason: 'No escalation policy configured' };
  }

  // Check if escalation is already completed - prevent re-triggering
  if (incident.escalationStatus === 'COMPLETED') {
    return { escalated: false, reason: 'Escalation already completed' };
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

    return { escalated: false, reason: 'All escalation steps exhausted' };
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
    return { escalated: false, reason: 'Escalation step not found' };
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
        const { scheduleEscalation } = await import('./jobs/queue');
        await scheduleEscalation(incidentId, currentStepIndex, stepDelayMs);
      } catch (error) {
        logger.error('Failed to schedule initial escalation job', {
          incidentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      return { escalated: false, reason: 'Escalation scheduled' };
    }

    if (scheduledAt.getTime() > now.getTime()) {
      return { escalated: false, reason: 'Escalation scheduled' };
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
    return { escalated: false, reason: 'Escalation already in progress' };
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
      const { scheduleEscalation } = await import('./jobs/queue');
      await scheduleEscalation(incidentId, currentStepIndex + 1, 0);
      return { escalated: false, reason: 'Escalation scheduled' };
    }
    return { escalated: false, reason: 'Invalid target configuration' };
  }

  // Resolve to user IDs using resolveEscalationTarget
  const notifyOnlyTeamLead = step.notifyOnlyTeamLead || false;
  const targetUserIds = await resolveEscalationTarget(
    step.targetType,
    targetId,
    new Date(),
    notifyOnlyTeamLead
  );

  const manualAssigneeId = incident.assigneeId;
  if (currentStepIndex === 0 && manualAssigneeId && !targetUserIds.includes(manualAssigneeId)) {
    targetUserIds.push(manualAssigneeId);
  }

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

    if (step.targetType === 'TEAM' && targetId) {
      await tx.incident.update({
        where: { id: incidentId },
        data: {
          team: { connect: { id: targetId } },
          assignee: { disconnect: true },
        },
      });
      return true;
    }

    if (targetUserIds.length > 0) {
      await tx.incident.update({
        where: { id: incidentId },
        data: {
          assignee: { connect: { id: targetUserIds[0] } },
          team: { disconnect: true },
        },
      });
    }

    return true;
  });

  if (!assignmentGenerationIsCurrent) {
    return supersededEscalationResult();
  }

  if (targetUserIds.length === 0) {
    const errorMessage = `Escalation step ${currentStepIndex + 1} (${step.targetType}: ${targetName}) resolved to no users.`;
    logger.warn('Escalation target resolved to no users', {
      incidentId,
      stepIndex: currentStepIndex,
      targetType: step.targetType,
      targetId,
      targetName,
    });

    const isLastStep = currentStepIndex >= policySteps.length - 1;

    await runSerializableTransaction(async tx => {
      await tx.incidentEvent.create({
        data: {
          incidentId,
          message:
            errorMessage +
            (isLastStep
              ? ' Escalation failed: no reachable responders.'
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
      const { scheduleEscalation } = await import('./jobs/queue');
      await scheduleEscalation(incidentId, currentStepIndex + 1, 0);
      return { escalated: false, reason: 'Escalation scheduled' };
    }
    return { escalated: false, reason: 'No users to notify' };
  }

  // Use escalation-step channels when configured, intersected with each
  // recipient's enabled channels by sendUserNotification.
  const { sendUserNotification } = await import('./user-notifications');
  const notificationsSent = [];
  const escalationChannels: NotificationChannel[] | undefined =
    step.notificationChannels.length > 0 ? step.notificationChannels : undefined;

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
      const result = await sendUserNotification(incidentId, userId, message, escalationChannels);
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

    // Assign based on target type
    // Only assign if the incident doesn't already have an assignee or team
    if (!currentIncident.assigneeId && !currentIncident.teamId && targetUserIds.length > 0) {
      if (step.targetType === 'TEAM' && targetId) {
        // Assign to team
        updateData.team = { connect: { id: targetId } };
        // Clear any user assignment
        updateData.assignee = { disconnect: true };
      } else {
        // Assign to first user (for USER or SCHEDULE target types)
        const selectedIndex =
          step.targetType === 'SCHEDULE'
            ? Array.from(`${incidentId}:${currentStepIndex}`).reduce(
                (sum, char) => sum + char.charCodeAt(0),
                0
              ) % targetUserIds.length
            : 0;
        updateData.assignee = { connect: { id: targetUserIds[selectedIndex] } };
        // Clear any team assignment
        updateData.team = { disconnect: true };
      }
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
      const { scheduleEscalation } = await import('./jobs/queue');
      await scheduleEscalation(incidentId, nextStepIndex, 0);
      return {
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
      const { scheduleEscalation } = await import('./jobs/queue');
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
    | ((incidentId: string, stepIndex?: number) => Promise<{ escalated: boolean; reason?: string }>)
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
          const reason = (result.reason || '').toLowerCase();
          const stateAlreadyHandled =
            reason.includes('already in progress') ||
            reason.includes('scheduled') ||
            reason.includes('already completed') ||
            reason.includes('exhausted') ||
            reason.includes('completed') ||
            reason.includes('no escalation policy') ||
            reason.includes('no users to notify') ||
            reason.includes('invalid target') ||
            reason.includes('step not found') ||
            reason.includes('superseded by lifecycle transition');

          // executeEscalation persists terminal states itself (including FAILED),
          // or intentionally no-ops when a newer lifecycle generation supersedes
          // the worker. Do not overwrite either authoritative state here.
          if (stateAlreadyHandled) continue;

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
        const isRetryable =
          errorMessage.includes('Serialization') ||
          errorMessage.includes('deadlock') ||
          errorMessage.includes('Connection');

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
