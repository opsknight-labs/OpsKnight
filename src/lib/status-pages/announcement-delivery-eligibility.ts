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

/**
 * Final provider-boundary fence for announcement subscriber email.
 * Returns null when the intent is still eligible; otherwise a durable reason
 * suitable for marking/suppressing the notification before provider I/O.
 */
export async function announcementEmailDeliveryRevoked(
  notificationId?: string
): Promise<string | null> {
  if (!notificationId) return null;

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

  // This fence is deliberately scoped only to status-page announcement intents.
  if (!notification || notification.sourceType !== 'STATUS_PAGE_ANNOUNCEMENT') return null;
  if (!notification.sourceId || !notification.fanout) {
    return 'Announcement notification delivery metadata is incomplete';
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
  if (!announcement) return 'Announcement no longer exists';

  const generation = await readAnnouncementNotificationGeneration(announcementId, statusPageId);
  if (generation == null) return 'Announcement notification generation is unavailable';
  if (notification.fanout.eventKey !== announcementGenerationEventKey(generation)) {
    return 'Announcement notification generation was superseded';
  }

  const timing = announcement.notificationTiming as AnnouncementNotificationTiming;
  if (!['NONE', 'ON_PUBLISH', 'AT_START'].includes(timing)) {
    return 'Announcement notification policy is invalid';
  }

  const plan = deriveAnnouncementNotificationPlan({
    isActive: announcement.isActive,
    notificationTiming: timing,
    publishAt: announcement.publishAt,
    startDate: announcement.startDate,
  });
  if (!plan.shouldNotify) return 'Announcement notification was disabled or withdrawn';

  return null;
}
