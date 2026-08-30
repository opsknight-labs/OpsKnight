import prisma from './prisma';

type InAppNotificationInput = {
  userIds: string[];
  type: 'INCIDENT' | 'SCHEDULE' | 'TEAM' | 'SERVICE';
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  dedupeWindowMs?: number;
};

export async function createInAppNotifications({
  userIds,
  type,
  title,
  message,
  entityType,
  entityId,
  dedupeWindowMs,
}: InAppNotificationInput) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return;

  // Event-outbox retries can re-run notification delivery after an external
  // provider failure. Keep the in-app notification idempotent for the same
  // user, entity, and message instead of adding a duplicate on every retry.
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
    where: {
      user: { status: 'ACTIVE' },
      layer: {
        scheduleId,
      },
    },
    select: {
      userId: true,
    },
  });

  return [...new Set(assignments.map(entry => entry.userId))];
}
