import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { triggerStatusPageWebhooks } from '@/lib/status-page-webhooks';
import { getBaseUrl } from '@/lib/env-validation';
import { getHealthSnapshot } from './health';
import { businessServiceChatTargets, enqueueBusinessServiceChat } from './chat-channels';
import { draftStatusPageUpdates } from './status-page-drafts';

export const BUSINESS_SERVICE_STATUS_EVENT = 'business_service.status_changed';
/** A status must hold this long since the last announcement before the next one goes out. */
export const STATUS_CHANGE_DEBOUNCE_MS = 3 * 60_000;

const BS_STATUS_LABEL: Record<string, string> = {
  OPERATIONAL: 'Operational',
  UNKNOWN: 'Unknown',
  MAINTENANCE: 'Maintenance',
  DEGRADED: 'Degraded',
  PARTIAL_OUTAGE: 'Partial outage',
  MAJOR_OUTAGE: 'Major outage',
};

export function describeStatusChange(name: string, from: string, to: string) {
  // eslint-disable-next-line security/detect-object-injection -- key is a closed typed union / internal name, never request input
  const label = (status: string) => BS_STATUS_LABEL[status] ?? status;
  return {
    title: `${name} is now ${label(to).toLowerCase()}`,
    message: `Its status changed from ${label(from)} to ${label(to)}.`,
  };
}

/**
 * Announces business-service status changes found by the 60 s impact reconcile: in-app to
 * followers, status-page webhooks and a drafted (or, when opted in, published) update on pages
 * that show the business service, and Slack/Teams posts to its contact channel and owner team's
 * channels. The first run per business service only records a baseline. Delivery is at least
 * once: every step writes under a stable per-transition key, then `lastNotifiedStatus` is
 * compare-and-set; a short debounce stops flapping.
 */
export async function emitBusinessServiceStatusChanges(now = new Date()): Promise<number> {
  const [snapshot, rows] = await Promise.all([
    getHealthSnapshot(),
    prisma.businessService.findMany({
      select: {
        id: true,
        name: true,
        contactChannel: true,
        ownerTeamId: true,
        autoPublishStatusUpdates: true,
        lastNotifiedStatus: true,
        lastNotifiedStatusAt: true,
        followers: { select: { userId: true } },
        statusPages: {
          where: { showOnPage: true, statusPage: { enabled: true } },
          select: { statusPageId: true, displayName: true },
        },
      },
    }),
  ]);
  let announced = 0;
  for (const row of rows) {
    const health = snapshot.health.get(row.id);
    if (!health || health.status === row.lastNotifiedStatus) continue;
    const claim = () =>
      prisma.businessService.updateMany({
        where: { id: row.id, lastNotifiedStatus: row.lastNotifiedStatus },
        data: { lastNotifiedStatus: health.status, lastNotifiedStatusAt: now },
      });
    if (row.lastNotifiedStatus === null) {
      await claim(); // first run per business service: baseline only
      continue;
    }
    // Debounce: a status that flaps back within the window never announces either flip.
    if (
      row.lastNotifiedStatusAt &&
      now.getTime() - row.lastNotifiedStatusAt.getTime() < STATUS_CHANGE_DEBOUNCE_MS
    )
      continue;
    const from = row.lastNotifiedStatus;
    const text = describeStatusChange(row.name, from, health.status);
    // The key names the transition, not the attempt, so a retry after a crash is deduplicated.
    const changeKey = `${row.id}:${from}:${health.status}:${row.lastNotifiedStatusAt?.getTime() ?? 0}`;
    try {
      // At least once: announce first, record the change last. A failure leaves the change
      // unrecorded, so the next reconcile announces it again under the same key.
      if (row.followers.length)
        await createInAppNotifications({
          userIds: row.followers.map(follower => follower.userId),
          type: 'SERVICE',
          ...text,
          entityType: 'BUSINESS_SERVICE',
          entityId: row.id,
          dedupeKey: `business-service-status:${changeKey}`,
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
          `${changeKey}:${BUSINESS_SERVICE_STATUS_EVENT}`
        );
      const targets = await businessServiceChatTargets(row);
      if (targets.length)
        await enqueueBusinessServiceChat({
          businessServiceId: row.id,
          targets,
          title: text.title,
          text: text.message,
          url: `${getBaseUrl()}/services/business/${row.id}`,
          templateKey: 'business-service-status-chat',
          eventKey: changeKey,
        });
      if (row.statusPages.length)
        await draftStatusPageUpdates({
          businessService: row,
          pages: row.statusPages,
          from,
          to: health.status,
          changeKey,
          now,
        });
      if ((await claim()).count) announced += 1;
    } catch (error) {
      // The other business services still go out; this one is retried on the next run.
      logger.warn('business_services.status_event_failed', {
        id: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return announced;
}
