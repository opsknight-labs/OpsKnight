import 'server-only';

import { revalidatePath } from 'next/cache';
import type { IncidentStatus } from '@prisma/client';

import {
  assertCanAcknowledgeIncident,
  assertResponderOrAbove,
  getCurrentUser,
} from '@/lib/rbac';
import { getUserFriendlyError } from '@/lib/user-friendly-errors';
import { logger } from '@/lib/logger';
import {
  executeIncidentLifecycleCommand,
  transitionIncidentToStatus,
  type IncidentLifecycleResult,
  type IncidentLifecycleSource,
} from '@/lib/incidents/lifecycle';

type OperatorLifecycleSource = Extract<IncidentLifecycleSource, 'WEB' | 'MOBILE'>;

async function dispatchLifecycleSideEffects(result: IncidentLifecycleResult): Promise<void> {
  if (!result.changed) return;

  const { incidentId, status, previousStatus } = result;

  try {
    const { sendIncidentNotifications } = await import('@/lib/user-notifications');
    if (status === 'ACKNOWLEDGED') {
      await sendIncidentNotifications(incidentId, 'acknowledged');
    } else if (status === 'RESOLVED') {
      await sendIncidentNotifications(incidentId, 'resolved');
    } else if (status === 'OPEN' && previousStatus !== 'OPEN') {
      await sendIncidentNotifications(incidentId, 'updated');
    }
  } catch (error) {
    logger.error('Service notification failed', {
      component: 'incident-lifecycle',
      error,
      incidentId,
    });
  }

  try {
    const { scheduleStatusPageNotification } = await import('@/lib/jobs/queue');
    const event =
      status === 'ACKNOWLEDGED'
        ? 'acknowledged'
        : status === 'RESOLVED'
          ? 'resolved'
          : status === 'OPEN'
            ? 'investigating'
            : status === 'SNOOZED'
              ? 'snoozed'
              : status === 'SUPPRESSED'
                ? 'suppressed'
                : null;

    if (event) {
      await scheduleStatusPageNotification(incidentId, event);
    }
  } catch (error) {
    logger.error('Status page subscriber notification failed', {
      component: 'incident-lifecycle',
      error,
      incidentId,
    });
  }

  if (status === 'RESOLVED') {
    try {
      const { archiveWarRoomChannel } = await import('@/lib/chatops/war-room');
      await archiveWarRoomChannel(incidentId);
    } catch (error) {
      logger.error('ChatOps war-room archive failed', {
        component: 'incident-lifecycle',
        error,
        incidentId,
      });
    }
  } else {
    try {
      const { postWarRoomUpdate, updateWarRoomTopic } = await import('@/lib/chatops/war-room');
      const statusEmoji: Record<Exclude<IncidentStatus, 'RESOLVED'>, string> = {
        ACKNOWLEDGED: '👀',
        OPEN: '🔄',
        SNOOZED: '😴',
        SUPPRESSED: '🔇',
      };

      const [postResult, topicResult] = await Promise.allSettled([
        postWarRoomUpdate(
          incidentId,
          `${statusEmoji[status as Exclude<IncidentStatus, 'RESOLVED'>]} *Status updated to ${status}*`
        ),
        updateWarRoomTopic(incidentId, status),
      ]);

      if (postResult.status === 'rejected') {
        logger.error('ChatOps status sync failed', {
          component: 'incident-lifecycle',
          error: postResult.reason,
          incidentId,
        });
      }
      if (topicResult.status === 'rejected') {
        logger.error('ChatOps topic sync failed', {
          component: 'incident-lifecycle',
          error: topicResult.reason,
          incidentId,
        });
      }
    } catch (error) {
      logger.error('Failed to load ChatOps lifecycle handlers', {
        component: 'incident-lifecycle',
        error,
        incidentId,
      });
    }
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/incidents');
  revalidatePath('/');
}

/**
 * Internal application service for human/operator lifecycle changes.
 * Authorization is deliberately performed before the domain command.
 */
export async function updateIncidentStatus(
  id: string,
  status: IncidentStatus,
  expectedStatus: IncidentStatus | undefined,
  source: OperatorLifecycleSource
): Promise<void> {
  try {
    // Preserve the centralized authorization contract introduced in #405:
    // scoped users may ACK incidents they can access; every other lifecycle
    // mutation requires responder-or-above.
    if (status === 'ACKNOWLEDGED') await assertCanAcknowledgeIncident(id);
    else await assertResponderOrAbove();
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }

  const result = await transitionIncidentToStatus({
    incidentId: id,
    status,
    expectedStatus,
    source,
  });

  await dispatchLifecycleSideEffects(result);
}

export async function resolveIncidentWithNote(
  id: string,
  resolution: string,
  source: OperatorLifecycleSource = 'WEB'
): Promise<void> {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }

  const trimmedResolution = resolution?.trim();
  if (!trimmedResolution || trimmedResolution.length < 10) {
    throw new Error(
      'Resolution note must be at least 10 characters. Please provide more details about how the incident was resolved.'
    );
  }
  if (trimmedResolution.length > 1000) {
    throw new Error(
      'Resolution note must be 1000 characters or fewer. Please shorten your description.'
    );
  }

  const user = await getCurrentUser();
  const result = await executeIncidentLifecycleCommand({
    incidentId: id,
    command: 'RESOLVE',
    source,
    actor: { id: user.id, name: user.name ?? undefined },
    resolutionNote: trimmedResolution,
  });

  await dispatchLifecycleSideEffects(result);
}
