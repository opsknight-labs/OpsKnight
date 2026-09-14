import 'server-only';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notifyStatusPageSubscribersAnnouncement } from '@/lib/status-page-notifications';
import {
  deriveAnnouncementNotificationPlan,
  type AnnouncementNotificationTiming,
} from './announcement-notification-plan';
import { readAnnouncementNotificationGeneration } from './announcement-notification-generation';
import type { AnnouncementFanoutDeliveryMode } from './announcement-fanout-contract';

export type AnnouncementFanoutExecutionResult =
  | { status: 'EXECUTED'; sent: number; failed: number }
  | { status: 'STALE'; reason: string }
  | { status: 'NOT_DUE'; retryAt: Date };

export async function executeAnnouncementNotificationFanout(
  announcementId: string,
  statusPageId: string,
  expectedGeneration: number,
  deliveryMode: AnnouncementFanoutDeliveryMode = 'ALL_ELIGIBLE'
): Promise<AnnouncementFanoutExecutionResult> {
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
    return { status: 'STALE', reason: 'Announcement no longer exists' };
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
    return { status: 'STALE', reason: 'Announcement generation was superseded' };
  }

  const timing = announcement.notificationTiming as AnnouncementNotificationTiming;
  if (!['ON_PUBLISH', 'AT_START', 'NONE'].includes(timing)) {
    logger.warn('status_page.announcement_fanout_invalid_policy', {
      announcementId,
      statusPageId,
      notificationTiming: announcement.notificationTiming,
    });
    return { status: 'STALE', reason: 'Announcement notification policy is invalid' };
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
    return { status: 'STALE', reason: 'Announcement notification was disabled or withdrawn' };
  }

  // A valid current generation that is slightly early is not stale. Returning
  // NOT_DUE allows the durable queue to put the same job back at the canonical
  // schedule without consuming failure budget or dropping the campaign.
  if (plan.scheduledAt.getTime() > Date.now() + 1_000) {
    logger.info('status_page.announcement_fanout_not_due', {
      announcementId,
      statusPageId,
      expectedGeneration,
      canonicalScheduledAt: plan.scheduledAt.toISOString(),
    });
    return { status: 'NOT_DUE', retryAt: plan.scheduledAt };
  }

  const result = await notifyStatusPageSubscribersAnnouncement(
    announcementId,
    statusPageId,
    expectedGeneration,
    deliveryMode
  );
  if (result.skipped) {
    return { status: 'STALE', reason: 'Announcement changed while fan-out was materializing' };
  }
  return { status: 'EXECUTED', sent: result.sent, failed: result.failed };
}
