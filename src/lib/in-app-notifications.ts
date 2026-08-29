import prisma from './prisma';

type InAppNotificationInput = {
  userIds: string[];
  type: 'INCIDENT' | 'SCHEDULE' | 'TEAM' | 'SERVICE';
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
};

export async function createInAppNotifications({
  userIds,
  type,
  title,
  message,
  entityType,
  entityId,
}: InAppNotificationInput) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return;

  await prisma.inAppNotification.createMany({
    data: uniqueUserIds.map(userId => ({
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
