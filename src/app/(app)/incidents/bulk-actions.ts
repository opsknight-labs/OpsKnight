'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { logger } from '@/lib/logger';

export async function bulkAcknowledge(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    // Update all selected incidents to ACKNOWLEDGED
    await prisma.incident.updateMany({
      where: {
        id: { in: incidentIds },
        status: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED'] }, // Only update non-resolved incidents
      },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        escalationStatus: 'COMPLETED',
        nextEscalationAt: null,
      },
    });

    // Log events for each incident (batch create)
    const user = await getCurrentUser();
    await prisma.incidentEvent.createMany({
      data: incidentIds.map(incidentId => ({
        incidentId,
        type: 'ACKNOWLEDGED',
        message: `Bulk acknowledged${user ? ` by ${user.name}` : ''}`,
      })),
    });

    // Fetch all incidents in a single query for notifications and webhooks
    const incidents = await prisma.incident.findMany({
      where: { id: { in: incidentIds } },
      include: {
        service: { select: { id: true, name: true } },
        assignee: {
          select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
        },
      },
    });

    // Send notifications in parallel
    const { sendIncidentNotifications } = await import('@/lib/user-notifications');
    const { notifyStatusPageSubscribers } = await import('@/lib/status-page-notifications');
    const { triggerWebhooksForService } = await import('@/lib/status-page-webhooks');

    await Promise.allSettled(
      incidents.map(async incident => {
        try {
          await Promise.all([
            sendIncidentNotifications(incident.id, 'acknowledged'),
            notifyStatusPageSubscribers(incident.id, 'acknowledged'),
            triggerWebhooksForService(incident.serviceId, 'incident.acknowledged', {
              id: incident.id,
              title: incident.title,
              description: incident.description,
              status: incident.status,
              urgency: incident.urgency,
              priority: incident.priority,
              service: incident.service,
              assignee: incident.assignee,
              createdAt: incident.createdAt.toISOString(),
              acknowledgedAt: incident.acknowledgedAt?.toISOString() || new Date().toISOString(),
            }),
          ]);
        } catch (e) {
          logger.error('Failed to send notifications for incident', {
            component: 'bulk-actions',
            action: 'acknowledge',
            error: e,
            incidentId: incident.id,
          });
        }
      })
    );

    revalidatePath('/incidents');
    revalidatePath('/');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk acknowledge failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: 'Failed to acknowledge incidents' };
  }
}

export async function bulkResolve(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    // Update all selected incidents to RESOLVED
    await prisma.incident.updateMany({
      where: {
        id: { in: incidentIds },
      },
      data: {
        status: 'RESOLVED',
        escalationStatus: 'COMPLETED',
        nextEscalationAt: null,
        resolvedAt: new Date(),
      },
    });

    // Log events for each incident (batch create)
    const user = await getCurrentUser();
    await prisma.incidentEvent.createMany({
      data: incidentIds.map(incidentId => ({
        incidentId,
        type: 'MANUAL_RESOLVED',
        message: `Bulk resolved${user ? ` by ${user.name}` : ''}`,
      })),
    });

    // Fetch all incidents in a single query for notifications and webhooks
    const incidents = await prisma.incident.findMany({
      where: { id: { in: incidentIds } },
      include: {
        service: { select: { id: true, name: true } },
        assignee: {
          select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
        },
      },
    });

    // Send notifications & archive war-room channels in parallel
    const { sendIncidentNotifications } = await import('@/lib/user-notifications');
    const { notifyStatusPageSubscribers } = await import('@/lib/status-page-notifications');
    const { triggerWebhooksForService } = await import('@/lib/status-page-webhooks');
    const { archiveWarRoomChannel } = await import('@/lib/chatops/war-room');

    await Promise.allSettled(
      incidents.map(async incident => {
        try {
          await Promise.all([
            sendIncidentNotifications(incident.id, 'resolved'),
            notifyStatusPageSubscribers(incident.id, 'resolved'),
            archiveWarRoomChannel(incident.id).catch(err =>
              logger.warn('[ChatOps] Failed to archive war-room channel on bulk resolve', {
                incidentId: incident.id,
                error: err,
              })
            ),
            triggerWebhooksForService(incident.serviceId, 'incident.resolved', {
              id: incident.id,
              title: incident.title,
              description: incident.description,
              status: incident.status,
              urgency: incident.urgency,
              priority: incident.priority,
              service: incident.service,
              assignee: incident.assignee,
              createdAt: incident.createdAt.toISOString(),
              resolvedAt: incident.resolvedAt?.toISOString() || new Date().toISOString(),
            }),
          ]);
        } catch (e) {
          logger.error('Failed to send notifications for incident', {
            component: 'bulk-actions',
            action: 'resolve',
            error: e,
            incidentId: incident.id,
          });
        }
      })
    );

    revalidatePath('/incidents');
    revalidatePath('/');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk resolve failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: 'Failed to resolve incidents' };
  }
}

export async function bulkReassign(incidentIds: string[], assigneeId: string) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  if (!assigneeId) {
    return { success: false, error: 'Assignee is required' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const assignee = await prisma.user.findUnique({ where: { id: assigneeId } });
    if (!assignee) {
      return { success: false, error: 'Assignee not found' };
    }

    // Update all selected incidents
    await prisma.incident.updateMany({
      where: {
        id: { in: incidentIds },
      },
      data: { assigneeId },
    });

    // Log events for each incident (batch create)
    const user = await getCurrentUser();
    await prisma.incidentEvent.createMany({
      data: incidentIds.map(incidentId => ({
        incidentId,
        message: `Bulk reassigned to ${assignee.name}${user ? ` by ${user.name}` : ''}`,
      })),
    });

    // Fetch all incidents in a single query for notifications and webhooks
    const incidents = await prisma.incident.findMany({
      where: { id: { in: incidentIds } },
      include: {
        service: { select: { id: true, name: true } },
        assignee: {
          select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
        },
      },
    });

    // Send notifications in parallel
    const { sendIncidentNotifications } = await import('@/lib/user-notifications');
    const { triggerWebhooksForService } = await import('@/lib/status-page-webhooks');

    await Promise.allSettled(
      incidents.map(async incident => {
        try {
          await Promise.all([
            sendIncidentNotifications(incident.id, 'updated'),
            triggerWebhooksForService(incident.serviceId, 'incident.updated', {
              id: incident.id,
              title: incident.title,
              description: incident.description,
              status: incident.status,
              urgency: incident.urgency,
              priority: incident.priority,
              service: incident.service,
              assignee: incident.assignee,
              createdAt: incident.createdAt.toISOString(),
            }),
          ]);
        } catch (e) {
          logger.error('Failed to send notifications for incident', {
            component: 'bulk-actions',
            action: 'reassign',
            error: e,
            incidentId: incident.id,
          });
        }
      })
    );

    revalidatePath('/incidents');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk reassign failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      assigneeId,
    });
    return { success: false, error: 'Failed to reassign incidents' };
  }
}

export async function bulkUpdatePriority(incidentIds: string[], priority: string) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    // Update all selected incidents
    await prisma.incident.updateMany({
      where: {
        id: { in: incidentIds },
      },
      data: { priority: priority || null },
    });

    // Log events for each incident (batch create)
    const user = await getCurrentUser();
    await prisma.incidentEvent.createMany({
      data: incidentIds.map(incidentId => ({
        incidentId,
        message: `Bulk priority updated to ${priority || 'Auto'}${user ? ` by ${user.name}` : ''}`,
      })),
    });

    revalidatePath('/incidents');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk priority update failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      priority,
    });
    return { success: false, error: 'Failed to update priority' };
  }
}

export async function bulkSnooze(
  incidentIds: string[],
  durationMinutes: number,
  reason: string | null
) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const snoozedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);

    // Update all selected incidents
    await prisma.incident.updateMany({
      where: {
        id: { in: incidentIds },
        status: { notIn: ['RESOLVED'] }, // Don't snooze resolved incidents
      },
      data: {
        status: 'SNOOZED',
        snoozedUntil,
        snoozeReason: reason,
        escalationStatus: 'PAUSED',
        nextEscalationAt: null,
      },
    });

    // Log events for each incident (batch create)
    const user = await getCurrentUser();
    const userTimeZone = getUserTimeZone(user ?? undefined);
    await prisma.incidentEvent
      .createMany({
        data: incidentIds.map(incidentId => ({
          incidentId,
          message: `Bulk snoozed until ${formatDateTime(snoozedUntil, userTimeZone, { format: 'datetime' })}${reason ? `: ${reason}` : ''}${user ? ` by ${user.name}` : ''}`,
        })),
        skipDuplicates: true,
      })
      .catch(() => {}); // Ignore errors if incident was already resolved

    revalidatePath('/incidents');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk snooze failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      durationMinutes,
    });
    return { success: false, error: 'Failed to snooze incidents' };
  }
}

export async function bulkUnsnooze(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    // Update all selected incidents
    await prisma.incident.updateMany({
      where: {
        id: { in: incidentIds },
        status: 'SNOOZED',
      },
      data: {
        status: 'OPEN',
        snoozedUntil: null,
        snoozeReason: null,
        escalationStatus: 'ESCALATING',
        nextEscalationAt: new Date(),
      },
    });

    // Log events for each incident (batch create)
    const user = await getCurrentUser();
    await prisma.incidentEvent
      .createMany({
        data: incidentIds.map(incidentId => ({
          incidentId,
          message: `Bulk unsnoozed${user ? ` by ${user.name}` : ''}`,
        })),
        skipDuplicates: true,
      })
      .catch(() => {}); // Ignore errors if incident wasn't snoozed

    revalidatePath('/incidents');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk unsnooze failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: 'Failed to unsnooze incidents' };
  }
}

export async function bulkSuppress(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    // Update all selected incidents
    await prisma.incident.updateMany({
      where: {
        id: { in: incidentIds },
        status: { notIn: ['RESOLVED'] }, // Don't suppress resolved incidents
      },
      data: {
        status: 'SUPPRESSED',
        escalationStatus: 'PAUSED',
        nextEscalationAt: null,
      },
    });

    // Log events for each incident (batch create)
    const user = await getCurrentUser();
    await prisma.incidentEvent
      .createMany({
        data: incidentIds.map(incidentId => ({
          incidentId,
          message: `Bulk suppressed${user ? ` by ${user.name}` : ''}`,
        })),
        skipDuplicates: true,
      })
      .catch(() => {}); // Ignore errors if incident was already resolved

    revalidatePath('/incidents');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk suppress failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: 'Failed to suppress incidents' };
  }
}

export async function bulkUnsuppress(incidentIds: string[]) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    // Update all selected incidents
    await prisma.incident.updateMany({
      where: {
        id: { in: incidentIds },
        status: 'SUPPRESSED',
      },
      data: {
        status: 'OPEN',
        escalationStatus: 'ESCALATING',
        nextEscalationAt: new Date(),
      },
    });

    // Log events for each incident (batch create)
    const user = await getCurrentUser();
    await prisma.incidentEvent
      .createMany({
        data: incidentIds.map(incidentId => ({
          incidentId,
          message: `Bulk unsuppressed${user ? ` by ${user.name}` : ''}`,
        })),
        skipDuplicates: true,
      })
      .catch(() => {}); // Ignore errors if incident wasn't suppressed

    revalidatePath('/incidents');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk unsuppress failed', { component: 'bulk-actions', error, incidentIds });
    return { success: false, error: 'Failed to unsuppress incidents' };
  }
}

export async function bulkUpdateUrgency(incidentIds: string[], urgency: 'HIGH' | 'MEDIUM' | 'LOW') {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    // Update all selected incidents
    await prisma.incident.updateMany({
      where: {
        id: { in: incidentIds },
      },
      data: { urgency },
    });

    // Log events for each incident (batch create)
    const user = await getCurrentUser();
    await prisma.incidentEvent.createMany({
      data: incidentIds.map(incidentId => ({
        incidentId,
        message: `Bulk urgency updated to ${urgency}${user ? ` by ${user.name}` : ''}`,
      })),
    });

    revalidatePath('/incidents');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk urgency update failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      urgency,
    });
    return { success: false, error: 'Failed to update urgency' };
  }
}

export async function bulkUpdateStatus(
  incidentIds: string[],
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED'
) {
  if (!incidentIds || incidentIds.length === 0) {
    return { success: false, error: 'No incidents selected' };
  }

  try {
    await assertResponderOrAbove();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    if (status === 'OPEN') {
      const incidents = await prisma.incident.findMany({
        where: { id: { in: incidentIds } },
        select: {
          id: true,
          status: true,
          currentEscalationStep: true,
          acknowledgedAt: true,
          resolvedAt: true,
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

      for (const incident of incidents) {
        let nextEscalationAt: Date | null = new Date();
        if (incident.status === 'ACKNOWLEDGED') {
          const stepIndex = incident.currentEscalationStep ?? 0;
          const steps = incident.service?.policy?.steps ?? [];
          const step = steps.find((_, index) => index === stepIndex);
          const delayMinutes = step?.delayMinutes ?? 0;
          nextEscalationAt = new Date(Date.now() + delayMinutes * 60 * 1000);
        }

        await prisma.incident.update({
          where: { id: incident.id },
          data: {
            status,
            escalationStatus: 'ESCALATING',
            nextEscalationAt,
            acknowledgedAt:
              incident.status === 'ACKNOWLEDGED' || incident.status === 'RESOLVED'
                ? null
                : incident.acknowledgedAt,
            resolvedAt: incident.status === 'RESOLVED' ? null : incident.resolvedAt,
            currentEscalationStep:
              incident.status === 'RESOLVED' ? 0 : incident.currentEscalationStep,
          },
        });
      }
    } else {
      const updateData: any = { status }; // eslint-disable-line @typescript-eslint/no-explicit-any

      if (status === 'ACKNOWLEDGED') {
        updateData.acknowledgedAt = new Date();
        updateData.escalationStatus = 'COMPLETED';
        updateData.nextEscalationAt = null;
      } else if (status === 'RESOLVED') {
        updateData.resolvedAt = new Date();
        updateData.escalationStatus = 'COMPLETED';
        updateData.nextEscalationAt = null;
      } else if (status === 'SNOOZED' || status === 'SUPPRESSED') {
        updateData.escalationStatus = 'PAUSED';
        updateData.nextEscalationAt = null;
      }

      await prisma.incident.updateMany({
        where: {
          id: { in: incidentIds },
        },
        data: updateData,
      });
    }

    // Log events for each incident (batch create)
    const user = await getCurrentUser();
    await prisma.incidentEvent.createMany({
      data: incidentIds.map(incidentId => ({
        incidentId,
        message: `Bulk status updated to ${status}${user ? ` by ${user.name}` : ''}`,
      })),
    });

    // Fetch all incidents in a single query for notifications and webhooks
    const incidents = await prisma.incident.findMany({
      where: { id: { in: incidentIds } },
      include: {
        service: { select: { id: true, name: true } },
        assignee: {
          select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
        },
      },
    });

    // Send notifications in parallel
    const { sendIncidentNotifications } = await import('@/lib/user-notifications');
    const { notifyStatusPageSubscribers } = await import('@/lib/status-page-notifications');
    const { triggerWebhooksForService } = await import('@/lib/status-page-webhooks');

    // Determine event type once
    let eventType = 'incident.updated';
    if (status === 'RESOLVED') eventType = 'incident.resolved';
    else if (status === 'ACKNOWLEDGED') eventType = 'incident.acknowledged';
    else if (status === 'SNOOZED') eventType = 'incident.snoozed';
    else if (status === 'SUPPRESSED') eventType = 'incident.suppressed';

    await Promise.allSettled(
      incidents.map(async incident => {
        try {
          const notificationPromises: Promise<unknown>[] = [];

          if (status === 'ACKNOWLEDGED') {
            notificationPromises.push(
              sendIncidentNotifications(incident.id, 'acknowledged'),
              notifyStatusPageSubscribers(incident.id, 'acknowledged')
            );
          } else if (status === 'RESOLVED') {
            const { archiveWarRoomChannel } = await import('@/lib/chatops/war-room');
            notificationPromises.push(
              sendIncidentNotifications(incident.id, 'resolved'),
              notifyStatusPageSubscribers(incident.id, 'resolved'),
              archiveWarRoomChannel(incident.id).catch(err =>
                logger.warn('[ChatOps] Failed to archive war-room channel on bulk status update', {
                  incidentId: incident.id,
                  error: err,
                })
              )
            );
          } else if (status === 'OPEN') {
            notificationPromises.push(sendIncidentNotifications(incident.id, 'updated'));
          }

          notificationPromises.push(
            triggerWebhooksForService(incident.serviceId, eventType, {
              id: incident.id,
              title: incident.title,
              description: incident.description,
              status: incident.status,
              urgency: incident.urgency,
              priority: incident.priority,
              service: incident.service,
              assignee: incident.assignee,
              createdAt: incident.createdAt.toISOString(),
              acknowledgedAt: incident.acknowledgedAt?.toISOString() || null,
              resolvedAt: incident.resolvedAt?.toISOString() || null,
            })
          );

          await Promise.all(notificationPromises);
        } catch (e) {
          logger.error('Failed to send notifications for incident', {
            component: 'bulk-actions',
            action: 'status-update',
            error: e,
            incidentId: incident.id,
            status,
          });
        }
      })
    );

    revalidatePath('/incidents');
    return { success: true, count: incidentIds.length };
  } catch (error) {
    logger.error('Bulk status update failed', {
      component: 'bulk-actions',
      error,
      incidentIds,
      status,
    });
    return { success: false, error: 'Failed to update status' };
  }
}
