'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { logger } from '@/lib/logger';

export async function snoozeIncidentWithDuration(
  incidentId: string,
  durationMinutes: number,
  reason?: string
) {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { status: true },
  });

  if (!incident) {
    throw new Error('Incident not found');
  }

  if (incident.status === 'RESOLVED') {
    throw new Error('Cannot snooze an already resolved incident');
  }

  const snoozedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);
  const user = await getCurrentUser();
  const userTimeZone = getUserTimeZone(user ?? undefined);

  try {
    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        status: 'SNOOZED',
        snoozedUntil,
        snoozeReason: reason || null,
        escalationStatus: 'PAUSED',
        nextEscalationAt: null,
        events: {
          create: {
            type: 'STATUS_CHANGE',
            message: `Incident snoozed until ${formatDateTime(snoozedUntil, userTimeZone, { format: 'datetime' })}${reason ? ` (Reason: ${reason})` : ''}${user ? ` by ${user.name}` : ''}`,
          },
        },
      },
    });

    // Schedule auto-unsnooze job using PostgreSQL job queue
    try {
      const { scheduleAutoUnsnooze } = await import('@/lib/jobs/queue');
      await scheduleAutoUnsnooze(incidentId, snoozedUntil);
    } catch (error) {
      logger.error('Failed to schedule auto-unsnooze job', {
        component: 'snooze-actions',
        error,
        incidentId,
      });
      // Continue anyway - internal worker will pick it up via snoozedUntil field
    }

    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath('/incidents');
    revalidatePath('/');
  } catch (error) {
    logger.error('Failed to snooze incident', {
      component: 'snooze-actions',
      error,
      incidentId,
      userId: user?.id,
    });
    throw new Error('Failed to snooze incident. Please try again.');
  }
}

export async function processAutoUnsnooze() {
  const now = new Date();
  const incidentsToUnsnooze = await prisma.incident.findMany({
    where: {
      status: 'SNOOZED',
      snoozedUntil: { lte: now },
    },
    select: { id: true },
  });

  let processedCount = 0;
  for (const incident of incidentsToUnsnooze) {
    try {
      const policyData = await prisma.incident.findUnique({
        where: { id: incident.id },
        select: {
          status: true,
          currentEscalationStep: true,
          service: {
            select: {
              policy: {
                select: {
                  steps: {
                    orderBy: { stepOrder: 'asc' },
                    select: { delayMinutes: true },
                  },
                },
              },
            },
          },
        },
      });

      if (policyData?.status !== 'SNOOZED') continue;

      const stepIndex = policyData?.currentEscalationStep ?? 0;
      const delayMinutes = policyData?.service?.policy?.steps?.[stepIndex]?.delayMinutes ?? 0;
      const nextEscalationAt = new Date(Date.now() + delayMinutes * 60 * 1000);

      const claim = await prisma.incident.updateMany({
        where: {
          id: incident.id,
          status: 'SNOOZED',
          snoozedUntil: { lte: now },
        },
        data: {
          status: 'OPEN',
          snoozedUntil: null,
          snoozeReason: null,
          escalationStatus: 'ESCALATING',
          nextEscalationAt,
        },
      });

      if (claim.count === 0) continue;

      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          type: 'STATUS_CHANGE',
          message: 'Incident auto-unsnoozed (snooze duration expired)',
        },
      });
      processedCount++;
    } catch (error) {
      logger.error('Failed to unsnooze incident', {
        component: 'snooze-actions',
        incidentId: incident.id,
        error,
      });
      continue; // Skip to next incident
    }
    try {
      const { sendIncidentNotifications } = await import('@/lib/user-notifications');
      await sendIncidentNotifications(incident.id, 'updated');
      const { notifyStatusPageSubscribers } = await import('@/lib/status-page-notifications');
      await notifyStatusPageSubscribers(incident.id, 'investigating');
      const { triggerWebhooksForService } = await import('@/lib/status-page-webhooks');
      const updatedIncident = await prisma.incident.findUnique({
        where: { id: incident.id },
        include: {
          service: { select: { id: true, name: true } },
          assignee: {
            select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
          },
        },
      });
      if (updatedIncident) {
        await triggerWebhooksForService(updatedIncident.serviceId, 'incident.updated', {
          id: updatedIncident.id,
          title: updatedIncident.title,
          description: updatedIncident.description,
          status: updatedIncident.status,
          urgency: updatedIncident.urgency,
          priority: updatedIncident.priority,
          service: updatedIncident.service,
          assignee: updatedIncident.assignee,
          createdAt: updatedIncident.createdAt.toISOString(),
          acknowledgedAt: updatedIncident.acknowledgedAt?.toISOString() || null,
          resolvedAt: updatedIncident.resolvedAt?.toISOString() || null,
        });
      }
    } catch (error) {
      logger.error('Failed to notify after auto-unsnooze', {
        component: 'snooze-actions',
        incidentId: incident.id,
        error,
      });
    }
  }

  return { processed: processedCount };
}
