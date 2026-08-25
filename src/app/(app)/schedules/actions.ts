'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertAdminOrResponder, getCurrentUser } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { createInAppNotifications, getScheduleUserIds } from '@/lib/in-app-notifications';
import { parseDateTimeInTimeZone, isValidTimeZone } from '@/lib/timezone';
import { assertScheduleNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
type ScheduleFormState = {
  error?: string | null;
  success?: boolean;
};

async function getScheduleName(scheduleId: string) {
  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { name: true },
  });
  return schedule?.name || 'On-call schedule';
}

async function assertCanCreateScheduleOverride(scheduleId: string) {
  const user = await getCurrentUser();
  if (user.role === 'ADMIN') return user;

  const accessible = await prisma.onCallSchedule.findFirst({
    where: {
      id: scheduleId,
      OR: [
        { layers: { some: { users: { some: { userId: user.id } } } } },
        {
          escalationRules: {
            some: {
              policy: {
                services: {
                  some: {
                    team: { members: { some: { userId: user.id, role: 'OWNER' } } },
                  },
                },
              },
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  if (!accessible) {
    throw new Error(
      'Unauthorized. Only an administrator, owning team lead, or assigned schedule member can create overrides.'
    );
  }
  return user;
}

async function notifyScheduleMembers(
  scheduleId: string,
  title: string,
  message: string,
  recipientsOrActor?: string[] | string
) {
  try {
    let targetUserIds: string[];
    if (Array.isArray(recipientsOrActor)) {
      targetUserIds = recipientsOrActor;
    } else {
      const allUserIds = await getScheduleUserIds(scheduleId);
      targetUserIds =
        typeof recipientsOrActor === 'string'
          ? allUserIds.filter(id => id !== recipientsOrActor)
          : allUserIds;
    }

    if (targetUserIds.length > 0) {
      await createInAppNotifications({
        userIds: targetUserIds,
        type: 'SCHEDULE',
        title,
        message,
        entityType: 'SCHEDULE',
        entityId: scheduleId,
      });
    }
  } catch (_error) {
    // Non-critical, continue
  }
}

export async function createSchedule(
  _prevState: ScheduleFormState,
  formData: FormData
): Promise<ScheduleFormState> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  const name = (formData.get('name') as string)?.trim() || '';
  const timeZone = (formData.get('timeZone') as string) || 'UTC';

  if (!name) {
    return { error: 'Schedule name is required.' };
  }

  if (timeZone && !isValidTimeZone(timeZone)) {
    return { error: 'Invalid IANA timezone specified.' };
  }

  try {
    const normalizedName = await assertScheduleNameAvailable(name);
    const schedule = await prisma.onCallSchedule.create({
      data: { name: normalizedName, timeZone },
    });
    await logAudit({
      action: 'schedule.created',
      entityType: 'SCHEDULE',
      entityId: schedule.id,
      actorId,
      details: { name: normalizedName, timeZone },
    });

    revalidatePath('/schedules');
    return { success: true };
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      return { error: 'A schedule with that name already exists.' };
    }
    return { error: error instanceof Error ? error.message : 'Failed to create schedule.' };
  }
}

export async function updateSchedule(
  scheduleId: string,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }

  const name = (formData.get('name') as string)?.trim();
  const timeZone = (formData.get('timeZone') as string) || 'UTC';

  if (!name) {
    return { error: 'Schedule name is required.' };
  }

  if (timeZone && !isValidTimeZone(timeZone)) {
    return { error: 'Invalid IANA timezone specified.' };
  }

  try {
    const normalizedName = await assertScheduleNameAvailable(name, { excludeId: scheduleId });
    await prisma.onCallSchedule.update({
      where: { id: scheduleId },
      data: { name: normalizedName, timeZone },
    });
    await logAudit({
      action: 'schedule.updated',
      entityType: 'SCHEDULE',
      entityId: scheduleId,
      actorId,
      details: { name: normalizedName, timeZone },
    });

    const scheduleName = await getScheduleName(scheduleId);
    await notifyScheduleMembers(
      scheduleId,
      'Schedule updated',
      `Schedule "${scheduleName}" timezone and name updated`
    );

    revalidatePath(`/schedules/${scheduleId}`);
    revalidatePath('/schedules');
    return undefined;
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      return { error: 'A schedule with that name already exists.' };
    }
    return { error: error instanceof Error ? error.message : 'Failed to update schedule.' };
  }
}

export async function createLayer(
  scheduleId: string,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  const name = formData.get('name') as string;
  const start = formData.get('start') as string;
  const end = formData.get('end') as string;
  const rotationLength = Number(formData.get('rotationLengthHours'));
  const shiftLengthValue = formData.get('shiftLengthHours');
  const shiftLength = shiftLengthValue ? Number(shiftLengthValue) : null;

  // Parse restrictions
  const daysOfWeek = formData.getAll('daysOfWeek').map(Number);
  const restrictStartHour = formData.get('restrictStartHour');
  const restrictEndHour = formData.get('restrictEndHour');

  const startHourNum = restrictStartHour ? Number(restrictStartHour) : undefined;
  const endHourNum = restrictEndHour ? Number(restrictEndHour) : undefined;

  if (daysOfWeek.some(d => Number.isNaN(d) || d < 0 || d > 6)) {
    return { error: 'Days of week must be between 0 (Sun) and 6 (Sat).' };
  }
  if (
    (startHourNum ?? 0) < 0 ||
    (startHourNum ?? 0) > 23 ||
    (endHourNum ?? 0) < 0 ||
    (endHourNum ?? 0) > 23
  ) {
    return { error: 'Hours must be between 0 and 23.' };
  }
  const restrictions =
    daysOfWeek.length > 0 || restrictStartHour || restrictEndHour
      ? {
          daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : undefined,
          startHour: startHourNum,
          endHour: endHourNum,
        }
      : undefined;

  if (!name || !start || Number.isNaN(rotationLength) || rotationLength <= 0) {
    return { error: 'Invalid layer data. Name, start date, and rotation length are required.' };
  }
  if (shiftLength !== null && (Number.isNaN(shiftLength) || shiftLength <= 0)) {
    return { error: 'Shift length must be greater than 0 hours.' };
  }
  if (shiftLength !== null && shiftLength > rotationLength) {
    return { error: 'Shift length cannot exceed rotation length.' };
  }
  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { timeZone: true },
  });

  if (!schedule) {
    return { error: 'Schedule not found.' };
  }

  const startDate = parseDateTimeInTimeZone(start, schedule.timeZone);
  const endDate = end ? parseDateTimeInTimeZone(end, schedule.timeZone) : null;

  if (!startDate) {
    return { error: 'Invalid start date.' };
  }
  if (end && !endDate) {
    return { error: 'Invalid end date.' };
  }
  if (endDate && endDate <= startDate) {
    return { error: 'End date must be after start date.' };
  }

  try {
    const layer = await prisma.onCallLayer.create({
      data: {
        scheduleId,
        name,
        start: startDate,
        end: endDate && !Number.isNaN(endDate.getTime()) ? endDate : null,
        rotationLengthHours: rotationLength,
        shiftLengthHours: shiftLength,
        restrictions,
      },
    });
    await logAudit({
      action: 'schedule.layer.created',
      entityType: 'SCHEDULE',
      entityId: scheduleId,
      actorId,
      details: { layerId: layer.id, name },
    });

    const scheduleName = await getScheduleName(scheduleId);
    await notifyScheduleMembers(
      scheduleId,
      'Schedule updated',
      `Layer "${name}" added to ${scheduleName}`
    );

    revalidatePath(`/schedules/${scheduleId}`);
    revalidatePath('/schedules');
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create layer.' };
  }
}

export async function deleteLayer(
  scheduleId: string,
  layerId: string
): Promise<{ error?: string } | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  try {
    const layer = await prisma.onCallLayer.findFirst({
      where: { id: layerId, scheduleId },
      select: { name: true },
    });

    if (!layer) {
      return { error: 'Layer not found for this schedule.' };
    }

    await prisma.$transaction([
      prisma.onCallLayerUser.deleteMany({
        where: { layerId },
      }),
      prisma.onCallLayer.delete({
        where: { id: layerId },
      }),
    ]);
    await logAudit({
      action: 'schedule.layer.deleted',
      entityType: 'SCHEDULE',
      entityId: scheduleId,
      actorId,
      details: { layerId, name: layer.name },
    });

    const scheduleName = await getScheduleName(scheduleId);
    await notifyScheduleMembers(
      scheduleId,
      'Schedule updated',
      `Layer "${layer?.name || 'Layer'}" removed from ${scheduleName}`
    );

    revalidatePath(`/schedules/${scheduleId}`);
    revalidatePath('/schedules');
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to delete layer.' };
  }
}

export async function addLayerUser(
  layerId: string,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  const userId = formData.get('userId') as string;

  if (!userId) {
    return { error: 'User is required.' };
  }

  const layer = await prisma.onCallLayer.findUnique({
    where: { id: layerId },
    select: { scheduleId: true, name: true },
  });

  if (!layer) {
    return { error: 'Layer not found.' };
  }

  const existingAssignment = await prisma.onCallLayerUser.findFirst({
    where: {
      userId,
      layer: { scheduleId: layer.scheduleId },
    },
    select: {
      layerId: true,
      layer: { select: { name: true } },
      user: { select: { name: true } },
    },
  });

  if (existingAssignment) {
    const responderName = existingAssignment.user.name || 'This responder';
    if (existingAssignment.layerId === layerId) {
      return { error: `${responderName} is already assigned to "${layer.name}".` };
    }
    return {
      error: `${responderName} is already assigned to "${existingAssignment.layer.name}" in this schedule. Remove them from that layer before adding them to "${layer.name}".`,
    };
  }

  const maxPosition = await prisma.onCallLayerUser.aggregate({
    where: { layerId },
    _max: { position: true },
  });
  const nextPosition = (maxPosition._max.position ?? 0) + 1;
  const finalPosition = nextPosition;

  await prisma.onCallLayerUser.create({
    data: {
      layerId,
      userId,
      position: finalPosition,
    },
  });

  const ordered = await prisma.onCallLayerUser.findMany({
    where: { layerId },
    orderBy: { position: 'asc' },
  });

  await prisma.$transaction(
    ordered.map((entry, index) =>
      prisma.onCallLayerUser.update({
        where: { id: entry.id },
        data: { position: index + 1 },
      })
    )
  );
  await logAudit({
    action: 'schedule.member.added',
    entityType: 'SCHEDULE',
    entityId: layer.scheduleId,
    actorId,
    details: { layerId, userId, position: finalPosition },
  });

  const scheduleName = await getScheduleName(layer.scheduleId);
  await notifyScheduleMembers(
    layer.scheduleId,
    'Schedule updated',
    `You were added to ${scheduleName}`
  );

  revalidatePath(`/schedules/${layer.scheduleId}`);
  revalidatePath('/schedules');
}

export async function updateLayer(
  layerId: string,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  const name = formData.get('name') as string;
  const start = formData.get('start') as string;
  const end = formData.get('end') as string;
  const rotationLength = Number(formData.get('rotationLengthHours'));
  const shiftLengthValue = formData.get('shiftLengthHours');
  const shiftLength = shiftLengthValue ? Number(shiftLengthValue) : null;

  // Parse restrictions
  const daysOfWeek = formData.getAll('daysOfWeek').map(Number);
  const restrictStartHour = formData.get('restrictStartHour');
  const restrictEndHour = formData.get('restrictEndHour');

  const startHourNum = restrictStartHour ? Number(restrictStartHour) : undefined;
  const endHourNum = restrictEndHour ? Number(restrictEndHour) : undefined;

  if (daysOfWeek.some(d => Number.isNaN(d) || d < 0 || d > 6)) {
    return { error: 'Days of week must be between 0 (Sun) and 6 (Sat).' };
  }
  if (
    (startHourNum ?? 0) < 0 ||
    (startHourNum ?? 0) > 23 ||
    (endHourNum ?? 0) < 0 ||
    (endHourNum ?? 0) > 23
  ) {
    return { error: 'Hours must be between 0 and 23.' };
  }
  const restrictions =
    daysOfWeek.length > 0 || restrictStartHour || restrictEndHour
      ? {
          daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : undefined,
          startHour: startHourNum,
          endHour: endHourNum,
        }
      : undefined;

  if (!name || !start || Number.isNaN(rotationLength) || rotationLength <= 0) {
    return { error: 'Invalid layer data. Name, start date, and rotation length are required.' };
  }
  if (shiftLength !== null && (Number.isNaN(shiftLength) || shiftLength <= 0)) {
    return { error: 'Shift length must be greater than 0 hours.' };
  }
  if (shiftLength !== null && shiftLength > rotationLength) {
    return { error: 'Shift length cannot exceed rotation length.' };
  }

  const layerMeta = await prisma.onCallLayer.findUnique({
    where: { id: layerId },
    select: { scheduleId: true, schedule: { select: { timeZone: true } } },
  });

  if (!layerMeta) {
    return { error: 'Layer not found.' };
  }

  const startDate = parseDateTimeInTimeZone(start, layerMeta.schedule.timeZone);
  const endDate = end ? parseDateTimeInTimeZone(end, layerMeta.schedule.timeZone) : null;

  if (!startDate) {
    return { error: 'Invalid start date.' };
  }
  if (end && !endDate) {
    return { error: 'Invalid end date.' };
  }
  if (endDate && endDate <= startDate) {
    return { error: 'End date must be after start date.' };
  }

  try {
    await prisma.onCallLayer.update({
      where: { id: layerId },
      data: {
        name,
        start: startDate,
        end: endDate && !Number.isNaN(endDate.getTime()) ? endDate : null,
        rotationLengthHours: rotationLength,
        shiftLengthHours: shiftLength,
        restrictions,
      },
    });
    await logAudit({
      action: 'schedule.layer.updated',
      entityType: 'SCHEDULE',
      entityId: layerMeta.scheduleId,
      actorId,
      details: { layerId, name },
    });

    const scheduleName = await getScheduleName(layerMeta.scheduleId);
    await notifyScheduleMembers(
      layerMeta.scheduleId,
      'Schedule updated',
      `Layer "${name}" updated in ${scheduleName}`
    );

    revalidatePath(`/schedules/${layerMeta.scheduleId}`);
    revalidatePath('/schedules');
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to update layer.' };
  }
}
export async function moveLayerUser(
  layerId: string,
  userId: string,
  direction: 'up' | 'down'
): Promise<{ error?: string } | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  try {
    const layer = await prisma.onCallLayer.findUnique({
      where: { id: layerId },
      select: { scheduleId: true },
    });

    if (!layer) {
      return { error: 'Layer not found.' };
    }

    const users = await prisma.onCallLayerUser.findMany({
      where: { layerId },
      orderBy: { position: 'asc' },
    });
    const index = users.findIndex(u => u.userId === userId);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (index === -1 || targetIndex < 0 || targetIndex >= users.length) {
      return { error: 'Cannot move user in that direction.' };
    }

    const current = users[index];
    const target = users[targetIndex];

    await prisma.$transaction([
      prisma.onCallLayerUser.update({
        where: { id: current.id },
        data: { position: target.position },
      }),
      prisma.onCallLayerUser.update({
        where: { id: target.id },
        data: { position: current.position },
      }),
    ]);
    await logAudit({
      action: 'schedule.member.reordered',
      entityType: 'SCHEDULE',
      entityId: layer.scheduleId,
      actorId,
      details: { layerId, userId, direction },
    });

    revalidatePath(`/schedules/${layer.scheduleId}`);
    revalidatePath('/schedules');
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to move user.' };
  }
}

export async function removeLayerUser(
  layerId: string,
  userId: string
): Promise<{ error?: string } | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  try {
    const layer = await prisma.onCallLayer.findUnique({
      where: { id: layerId },
      select: { scheduleId: true },
    });

    if (!layer) {
      return { error: 'Layer not found.' };
    }

    await prisma.onCallLayerUser.delete({
      where: { layerId_userId: { layerId, userId } },
    });

    const remaining = await prisma.onCallLayerUser.findMany({
      where: { layerId },
      orderBy: { position: 'asc' },
    });

    await prisma.$transaction(
      remaining.map((entry, index) =>
        prisma.onCallLayerUser.update({
          where: { id: entry.id },
          data: { position: index + 1 },
        })
      )
    );
    await logAudit({
      action: 'schedule.member.removed',
      entityType: 'SCHEDULE',
      entityId: layer.scheduleId,
      actorId,
      details: { layerId, userId },
    });

    const scheduleName = await getScheduleName(layer.scheduleId);
    await notifyScheduleMembers(
      layer.scheduleId,
      'Schedule updated',
      `You were removed from ${scheduleName}`,
      [userId]
    );

    revalidatePath(`/schedules/${layer.scheduleId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to remove user from layer.' };
  }
}

export async function createOverride(
  scheduleId: string,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  let actorId: string;
  try {
    actorId = (await assertCanCreateScheduleOverride(scheduleId)).id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  const userId = formData.get('userId') as string;
  const replacesUserId = (formData.get('replacesUserId') as string) || null;
  const start = formData.get('start') as string;
  const end = formData.get('end') as string;

  if (!userId || !start || !end) {
    return { error: 'User, start date, and end date are required.' };
  }

  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { timeZone: true },
  });

  if (!schedule) {
    return { error: 'Schedule not found.' };
  }

  const startDate = parseDateTimeInTimeZone(start, schedule.timeZone);
  const endDate = parseDateTimeInTimeZone(end, schedule.timeZone);

  if (!startDate || !endDate) {
    return { error: 'Invalid date format.' };
  }

  if (endDate <= startDate) {
    return { error: 'End date must be after start date.' };
  }

  try {
    const override = await prisma.onCallOverride.create({
      data: {
        scheduleId,
        userId,
        replacesUserId: replacesUserId || null,
        start: startDate,
        end: endDate,
      },
    });
    await logAudit({
      action: 'schedule.override.created',
      entityType: 'SCHEDULE',
      entityId: scheduleId,
      actorId,
      details: {
        overrideId: override.id,
        userId,
        replacesUserId,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    });

    const scheduleName = await getScheduleName(scheduleId);
    const recipientIds =
      replacesUserId && replacesUserId !== userId ? [userId, replacesUserId] : [userId];
    await notifyScheduleMembers(
      scheduleId,
      'Schedule override',
      `Override set on ${scheduleName}`,
      recipientIds
    );

    revalidatePath(`/schedules/${scheduleId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create override.' };
  }
}

export async function deleteOverride(
  scheduleId: string,
  overrideId: string
): Promise<{ error?: string } | undefined> {
  let actorId: string;
  try {
    actorId = (await assertCanCreateScheduleOverride(scheduleId)).id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  try {
    const override = await prisma.onCallOverride.findFirst({
      where: { id: overrideId, scheduleId },
      select: { userId: true, replacesUserId: true },
    });

    if (!override) {
      return { error: 'Override not found for this schedule.' };
    }

    await prisma.onCallOverride.delete({
      where: { id: overrideId },
    });
    await logAudit({
      action: 'schedule.override.deleted',
      entityType: 'SCHEDULE',
      entityId: scheduleId,
      actorId,
      details: { overrideId, userId: override.userId, replacesUserId: override.replacesUserId },
    });

    if (override) {
      const scheduleName = await getScheduleName(scheduleId);
      const recipientIds =
        override.replacesUserId && override.replacesUserId !== override.userId
          ? [override.userId, override.replacesUserId]
          : [override.userId];
      await notifyScheduleMembers(
        scheduleId,
        'Schedule override',
        `Override removed from ${scheduleName}`,
        recipientIds
      );
    }

    revalidatePath(`/schedules/${scheduleId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to delete override.' };
  }
}
