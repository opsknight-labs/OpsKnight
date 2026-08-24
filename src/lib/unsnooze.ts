import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Process expired incident snoozes (background cron safe - no request headers required).
 */
export async function processAutoUnsnoozeInternal(): Promise<{ processed: number }> {
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
      const delayMinutes = policyData?.service?.policy?.steps?.at(stepIndex)?.delayMinutes ?? 0;
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
        component: 'unsnooze',
        incidentId: incident.id,
        error,
      });
      continue;
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
        component: 'unsnooze',
        incidentId: incident.id,
        error,
      });
    }
  }

  return { processed: processedCount };
}
