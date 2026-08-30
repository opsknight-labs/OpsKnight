import prisma from './prisma';
import { inAppNotificationIntentId } from './notification-identity';

type InAppNotificationInput = {
  userIds: string[];
  type: 'INCIDENT' | 'SCHEDULE' | 'TEAM' | 'SERVICE';
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Stable event identity. Prefer this over a time-window dedupe. */
  dedupeKey?: string;
  /** Compatibility path for callers that do not yet have an event identity. */
  dedupeWindowMs?: number;
};

export async function createInAppNotifications({
  userIds,
  type,
  title,
  message,
  entityType,
  entityId,
  dedupeKey,
  dedupeWindowMs,
}: InAppNotificationInput) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return;

  if (dedupeKey) {
    await prisma.inAppNotification.createMany({
      data: uniqueUserIds.map(userId => ({
        id: inAppNotificationIntentId({
          eventKey: dedupeKey,
          userId,
          type,
          entityType: entityType || null,
          entityId: entityId || null,
        }),
        userId,
        type,
        title,
        message,
        entityType: entityType || null,
        entityId: entityId || null,
      })),
      skipDuplicates: true,
    });
    return;
  }

  const existing =
    dedupeWindowMs && typeof prisma.inAppNotification?.findMany === 'function'
      ? await prisma.inAppNotification.findMany({
          where: {
            userId: { in: uniqueUserIds },
            type,
            title,
            message,
            entityType: entityType || null,
            entityId: entityId || null,
            createdAt: { gte: new Date(Date.now() - dedupeWindowMs) },
          },
          select: { userId: true },
        })
      : [];
  const existingUserIds = new Set(existing.map(notification => notification.userId));
  const recipients = uniqueUserIds.filter(userId => !existingUserIds.has(userId));
  if (recipients.length === 0) return;

  await prisma.inAppNotification.createMany({
    data: recipients.map(userId => ({
      userId,
      type,
      title,
      message,
      entityType: entityType || null,
      entityId: entityId || null,
    })),
  });
}

export async function getScheduleUserIds(scheduleId: string): Promise<string[]> {
  const assignments = await prisma.onCallLayerUser.findMany({
    where: { user: { status: 'ACTIVE' }, layer: { scheduleId } },
    select: { userId: true },
  });
  return [...new Set(assignments.map(entry => entry.userId))];
}
