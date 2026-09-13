import 'server-only';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notifyStatusPageSubscribersAnnouncement } from '@/lib/status-page-notifications';
import {
  deriveAnnouncementNotificationPlan,
  type AnnouncementNotificationTiming,
} from './announcement-notification-plan';
import { readAnnouncementNotificationGeneration } from './announcement-notification-generation';

export async function executeAnnouncementNotificationFanout(
  announcementId: string,
  statusPageId: string,
  expectedGeneration: number
): Promise<{ sent: number; failed: number; skipped?: boolean }> {
  const announcement = await prisma.statusPageAnnouncement.findFirst({
    where: { id: announcementId, statusPageId },
    select: {
      id: true,
      statusPageId: true,
      isActive: true,
      notificationTiming: true,
      publishAt: true,
      startDate: true,
    },
  });

  if (!announcement) {
    logger.info('status_page.announcement_fanout_stale', {
      announcementId,
      statusPageId,
      expectedGeneration,
      reason: 'announcement_missing',
    });
    return { sent: 0, failed: 0, skipped: true };
  }

  const currentGeneration = await readAnnouncementNotificationGeneration(
    announcementId,
    statusPageId
  );
  if (currentGeneration == null || expectedGeneration !== currentGeneration) {
    logger.info('status_page.announcement_fanout_stale_generation', {
      announcementId,
      statusPageId,
      expectedGeneration,
      currentGeneration,
    });
    return { sent: 0, failed: 0, skipped: true };
  }

  const timing = announcement.notificationTiming as AnnouncementNotificationTiming;
  if (!['ON_PUBLISH', 'AT_START', 'NONE'].includes(timing)) {
    logger.warn('status_page.announcement_fanout_invalid_policy', {
      announcementId,
      statusPageId,
      notificationTiming: announcement.notificationTiming,
    });
    return { sent: 0, failed: 0, skipped: true };
  }

  const plan = deriveAnnouncementNotificationPlan({
    isActive: announcement.isActive,
    notificationTiming: timing,
    publishAt: announcement.publishAt,
    startDate: announcement.startDate,
  });

  if (!plan.shouldNotify || !plan.scheduledAt) {
    logger.info('status_page.announcement_fanout_stale', {
      announcementId,
      statusPageId,
      expectedGeneration,
      reason: 'notification_disabled',
    });
    return { sent: 0, failed: 0, skipped: true };
  }

  // A due queue job must never execute before the latest committed schedule.
  if (plan.scheduledAt.getTime() > Date.now() + 1_000) {
    logger.info('status_page.announcement_fanout_stale', {
      announcementId,
      statusPageId,
      expectedGeneration,
      canonicalScheduledAt: plan.scheduledAt.toISOString(),
      reason: 'canonical_schedule_in_future',
    });
    return { sent: 0, failed: 0, skipped: true };
  }

  return notifyStatusPageSubscribersAnnouncement(
    announcementId,
    statusPageId,
    expectedGeneration
  );
}
