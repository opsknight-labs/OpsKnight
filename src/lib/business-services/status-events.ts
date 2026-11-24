import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { triggerStatusPageWebhooks } from '@/lib/status-page-webhooks';
import { getHealthSnapshot } from './health';

export const BUSINESS_SERVICE_STATUS_EVENT = 'business_service.status_changed';

const BS_STATUS_LABEL: Record<string, string> = {
  OPERATIONAL: 'Operational',
  UNKNOWN: 'Unknown',
  MAINTENANCE: 'Maintenance',
  DEGRADED: 'Degraded',
  PARTIAL_OUTAGE: 'Partial outage',
  MAJOR_OUTAGE: 'Major outage',
};

export function describeStatusChange(name: string, from: string, to: string) {
  const label = (status: string) => BS_STATUS_LABEL[status] ?? status;
  return {
    title: `${name} is now ${label(to).toLowerCase()}`,
    message: `Its status changed from ${label(from)} to ${label(to)}.`,
  };
}

/**
 * Announces business-service status changes found by the 60 s impact reconcile: in-app to
 * followers and via status-page webhooks (pages that show the business service). The first run per
 * business service only records a baseline. A compare-and-set on `lastNotifiedStatus` makes
 * each change fire once even when several instances reconcile at the same time.
 * shortcut: Slack/Teams and an announcement draft are not wired (those channels are incident-keyed).
 */
export async function emitBusinessServiceStatusChanges(now = new Date()): Promise<number> {
  const [snapshot, rows] = await Promise.all([
    getHealthSnapshot(),
    prisma.businessService.findMany({
      select: {
        id: true,
        name: true,
        lastNotifiedStatus: true,
        followers: { select: { userId: true } },
        statusPages: {
          where: { showOnPage: true, statusPage: { enabled: true } },
          select: { statusPageId: true },
        },
      },
    }),
  ]);
  let announced = 0;
  for (const row of rows) {
    const health = snapshot.health.get(row.id);
    if (!health || health.status === row.lastNotifiedStatus) continue;
    const claimed = await prisma.businessService.updateMany({
      where: { id: row.id, lastNotifiedStatus: row.lastNotifiedStatus },
      data: { lastNotifiedStatus: health.status, lastNotifiedStatusAt: now },
    });
    if (!claimed.count || row.lastNotifiedStatus === null) continue; // lost the race, or baseline
    announced += 1;
    const from = row.lastNotifiedStatus;
    const text = describeStatusChange(row.name, from, health.status);
    try {
      if (row.followers.length)
        await createInAppNotifications({
          userIds: row.followers.map(follower => follower.userId),
          type: 'SERVICE',
          ...text,
          entityType: 'BUSINESS_SERVICE',
          entityId: row.id,
          dedupeKey: `business-service-status:${row.id}:${health.status}:${now.getTime()}`,
        });
      for (const { statusPageId } of row.statusPages)
        await triggerStatusPageWebhooks(
          statusPageId,
          BUSINESS_SERVICE_STATUS_EVENT,
          {
            id: row.id,
            name: row.name,
            previousStatus: from,
            status: health.status,
            since: health.since?.toISOString() ?? null,
            changedAt: now.toISOString(),
          },
          `${row.id}:${BUSINESS_SERVICE_STATUS_EVENT}:${health.status}:${now.getTime()}`
        );
    } catch (error) {
      // The change is recorded; a failed announcement must not stop the other business services.
      logger.warn('business_services.status_event_failed', {
        id: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return announced;
}
