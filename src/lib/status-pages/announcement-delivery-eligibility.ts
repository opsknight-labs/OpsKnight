import 'server-only';

import prisma from '@/lib/prisma';
import {
  announcementGenerationEventKey,
  readAnnouncementNotificationGeneration,
} from './announcement-notification-generation';
import {
  deriveAnnouncementNotificationPlan,
  type AnnouncementNotificationTiming,
} from './announcement-notification-plan';

export type AnnouncementDeliveryEligibility =
  | { status: 'ELIGIBLE' }
  | { status: 'NOT_DUE'; retryAt: Date; reason: string }
  | { status: 'STALE'; reason: string };

const ELIGIBLE: AnnouncementDeliveryEligibility = { status: 'ELIGIBLE' };

function stale(reason: string): AnnouncementDeliveryEligibility {
  return { status: 'STALE', reason };
}

/**
 * Final provider-boundary fence for announcement subscriber email.
 *
 * STALE means the intent can never be delivered and must be terminally
 * suppressed. NOT_DUE is deliberately non-terminal: the canonical generation
 * is still valid but provider delivery must be deferred until retryAt. This
 * distinction protects against scheduler/DB clock skew and early claims.
 */
export async function announcementEmailDeliveryEligibility(
  notificationId?: string
): Promise<AnnouncementDeliveryEligibility> {
  if (!notificationId) return ELIGIBLE;

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      sourceType: true,
      sourceId: true,
      fanout: {
        select: {
          statusPageId: true,
          eventKey: true,
        },
      },
    },
  });

  // Non-announcement email uses the ordinary delivery path.
  if (!notification || notification.sourceType !== 'STATUS_PAGE_ANNOUNCEMENT') return ELIGIBLE;
  if (!notification.sourceId || !notification.fanout) {
    return stale('Announcement notification delivery metadata is incomplete');
  }

  const announcementId = notification.sourceId;
  const statusPageId = notification.fanout.statusPageId;
  const announcement = await prisma.statusPageAnnouncement.findFirst({
    where: { id: announcementId, statusPageId },
    select: {
      isActive: true,
      notificationTiming: true,
      publishAt: true,
      startDate: true,
    },
  });
  if (!announcement) return stale('Announcement no longer exists');

  const generation = await readAnnouncementNotificationGeneration(announcementId, statusPageId);
  if (generation == null) return stale('Announcement notification generation is unavailable');
  if (notification.fanout.eventKey !== announcementGenerationEventKey(generation)) {
    return stale('Announcement notification generation was superseded');
  }

  const timing = announcement.notificationTiming as AnnouncementNotificationTiming;
  if (!['NONE', 'ON_PUBLISH', 'AT_START'].includes(timing)) {
    return stale('Announcement notification policy is invalid');
  }

  const plan = deriveAnnouncementNotificationPlan({
    isActive: announcement.isActive,
    notificationTiming: timing,
    publishAt: announcement.publishAt,
    startDate: announcement.startDate,
  });
  if (!plan.shouldNotify || !plan.scheduledAt) {
    return stale('Announcement notification was disabled or withdrawn');
  }

  const nowMs = Date.now();
  const retryAtMs = Math.max(announcement.publishAt.getTime(), plan.scheduledAt.getTime());
  // One second absorbs sub-second DB/application clock differences without
  // converting a genuinely early claim into a terminal suppression.
  if (retryAtMs > nowMs + 1_000) {
    return {
      status: 'NOT_DUE',
      retryAt: new Date(retryAtMs),
      reason: 'Announcement notification canonical send time has not arrived yet',
    };
  }

  return ELIGIBLE;
}
