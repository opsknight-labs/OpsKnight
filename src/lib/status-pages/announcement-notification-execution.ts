import 'server-only';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notifyStatusPageSubscribersAnnouncement } from '@/lib/status-page-notifications';
import {
  announcementRevision,
  deriveAnnouncementNotificationPlan,
  type AnnouncementNotificationTiming,
} from './announcement-notification-plan';

export async function executeAnnouncementNotificationFanout(
  announcementId: string,
  statusPageId: string,
  expectedRevision: string
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
      updatedAt: true,
    },
  });

  if (!announcement) {
    logger.info('status_page.announcement_fanout_stale', {
      announcementId,
      statusPageId,
      reason: 'announcement_missing',
    });
    return { sent: 0, failed: 0, skipped: true };
  }

  const currentRevision = announcementRevision(announcement.updatedAt);
  if (!expectedRevision || expectedRevision !== currentRevision) {
    logger.info('status_page.announcement_fanout_stale', {
      announcementId,
      statusPageId,
      expectedRevision: expectedRevision || null,
      currentRevision,
      reason: 'revision_mismatch',
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
      expectedRevision,
      reason: 'notification_disabled',
    });
    return { sent: 0, failed: 0, skipped: true };
  }

  // A due queue job must never execute before the latest committed schedule.
  // This is a second fence in addition to the BackgroundJob scheduledAt predicate.
  if (plan.scheduledAt.getTime() > Date.now() + 1_000) {
    logger.info('status_page.announcement_fanout_stale', {
      announcementId,
      statusPageId,
      expectedRevision,
      canonicalScheduledAt: plan.scheduledAt.toISOString(),
      reason: 'canonical_schedule_in_future',
    });
    return { sent: 0, failed: 0, skipped: true };
  }

  return notifyStatusPageSubscribersAnnouncement(announcementId, statusPageId);
}
