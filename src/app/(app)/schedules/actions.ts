'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertAdminOrResponder, getCurrentUser } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { createInAppNotifications, getScheduleUserIds } from '@/lib/in-app-notifications';
import { parseDateTimeInTimeZone, isValidTimeZone } from '@/lib/timezone';
import { assertScheduleNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import { AppError } from '@/lib/errors';
import {
  scheduleActionError,
  scheduleValidationError,
  type ScheduleActionState,
} from '@/lib/schedule-action-errors';
import {
  addScheduleLayerUser,
  createScheduleOverrideMutation,
  moveScheduleLayerUser,
  removeScheduleLayerUser,
} from '@/lib/schedules/mutations';

type ScheduleFormState = ScheduleActionState;

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
    throw new AppError({
      code: 'SCHEDULE_OVERRIDE_ACCESS_DENIED',
      userMessage:
        'Unauthorized. Only an administrator, owning team lead, or assigned schedule member can create overrides.',
      details: { scheduleId, userId: user.id },
    });
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
    // Notifications are non-critical to the mutation and must not roll it back.
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
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }
  const name = (formData.get('name') as string)?.trim() || '';
  const timeZone = (formData.get('timeZone') as string) || 'UTC';

  if (!name) {
    return scheduleValidationError('Schedule name is required.', [
      { field: 'name', code: 'required', message: 'Schedule name is required.' },
    ]);
  }

  if (timeZone && !isValidTimeZone(timeZone)) {
    return scheduleValidationError('Invalid IANA timezone specified.', [
      { field: 'timeZone', code: 'invalid', message: 'Invalid IANA timezone specified.' },
    ]);
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
      return scheduleActionError(
        new AppError({
          code: 'SCHEDULE_NAME_CONFLICT',
          userMessage: 'A schedule with that name already exists.',
          details: { name },
        }),
        'A schedule with that name already exists.'
      );
    }
    return scheduleActionError(error, 'Failed to create schedule.');
  }
}

export async function updateSchedule(
  scheduleId: string,
  formData: FormData
): Promise<ScheduleFormState | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }

  const name = (formData.get('name') as string)?.trim();
  const timeZone = (formData.get('timeZone') as string) || 'UTC';

  if (!name) {
    return scheduleValidationError('Schedule name is required.', [
      { field: 'name', code: 'required', message: 'Schedule name is required.' },
    ]);
  }

  if (timeZone && !isValidTimeZone(timeZone)) {
    return scheduleValidationError('Invalid IANA timezone specified.', [
      { field: 'timeZone', code: 'invalid', message: 'Invalid IANA timezone specified.' },
    ]);
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
      return scheduleActionError(
        new AppError({
          code: 'SCHEDULE_NAME_CONFLICT',
          userMessage: 'A schedule with that name already exists.',
          details: { scheduleId, name },
        }),
        'A schedule with that name already exists.'
      );
    }
    return scheduleActionError(error, 'Failed to update schedule.');
  }
}

export async function createLayer(
  scheduleId: string,
  formData: FormData
): Promise<ScheduleFormState | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }
  const name = formData.get('name') as string;
  const start = formData.get('start') as string;
  const end = formData.get('end') as string;
  const rotationLength = Number(formData.get('rotationLengthHours'));
  const shiftLengthValue = formData.get('shiftLengthHours');
  const shiftLength = shiftLengthValue ? Number(shiftLengthValue) : null;

  const daysOfWeek = formData.getAll('daysOfWeek').map(Number);
  const restrictStartHour = formData.get('restrictStartHour');
  const restrictEndHour = formData.get('restrictEndHour');

  const startHourNum = restrictStartHour ? Number(restrictStartHour) : undefined;
  const endHourNum = restrictEndHour ? Number(restrictEndHour) : undefined;

  if (daysOfWeek.some(d => Number.isNaN(d) || d < 0 || d > 6)) {
    return scheduleValidationError('Days of week must be between 0 (Sun) and 6 (Sat).');
  }
  if (
    (startHourNum ?? 0) < 0 ||
    (startHourNum ?? 0) > 23 ||
    (endHourNum ?? 0) < 0 ||
    (endHourNum ?? 0) > 23
  ) {
    return scheduleValidationError('Hours must be between 0 and 23.');
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
    return scheduleValidationError(
      'Invalid layer data. Name, start date, and rotation length are required.'
    );
  }
  if (shiftLength !== null && (Number.isNaN(shiftLength) || shiftLength <= 0)) {
    return scheduleValidationError('Shift length must be greater than 0 hours.');
  }
  if (shiftLength !== null && shiftLength > rotationLength) {
    return scheduleValidationError('Shift length cannot exceed rotation length.');
  }
  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { timeZone: true },
  });

  if (!schedule) {
    return scheduleActionError(
      new AppError({
        code: 'SCHEDULE_NOT_FOUND',
        userMessage: 'Schedule not found.',
        details: { scheduleId },
      }),
      'Schedule not found.'
    );
  }

  const startDate = parseDateTimeInTimeZone(start, schedule.timeZone);
  const endDate = end ? parseDateTimeInTimeZone(end, schedule.timeZone) : null;

  if (!startDate) {
    return scheduleValidationError('Invalid start date.');
  }
  if (end && !endDate) {
    return scheduleValidationError('Invalid end date.');
  }
  if (endDate && endDate <= startDate) {
    return scheduleValidationError('End date must be after start date.');
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
    return scheduleActionError(error, 'Failed to create layer.');
  }
}

export async function deleteLayer(
  scheduleId: string,
  layerId: string
): Promise<ScheduleFormState | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }
  try {
    const layer = await prisma.onCallLayer.findFirst({
      where: { id: layerId, scheduleId },
      select: { name: true },
    });

    if (!layer) {
      return scheduleActionError(
        new AppError({
          code: 'SCHEDULE_LAYER_NOT_FOUND',
          userMessage: 'Layer not found for this schedule.',
          details: { scheduleId, layerId },
        }),
        'Layer not found for this schedule.'
      );
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
      `Layer "${layer.name || 'Layer'}" removed from ${scheduleName}`
    );

    revalidatePath(`/schedules/${scheduleId}`);
    revalidatePath('/schedules');
  } catch (error) {
    return scheduleActionError(error, 'Failed to delete layer.');
  }
}

export async function addLayerUser(
  layerId: string,
  formData: FormData
): Promise<ScheduleFormState | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }

  const userId = (formData.get('userId') as string)?.trim();
  if (!userId) {
    return scheduleValidationError('User is required.', [
      { field: 'userId', code: 'required', message: 'User is required.' },
    ]);
  }

  try {
    const assignment = await addScheduleLayerUser(layerId, userId);
    await logAudit({
      action: 'schedule.member.added',
      entityType: 'SCHEDULE',
      entityId: assignment.scheduleId,
      actorId,
      details: { layerId, userId, position: assignment.position },
    });

    const scheduleName = await getScheduleName(assignment.scheduleId);
    await notifyScheduleMembers(
      assignment.scheduleId,
      'Schedule updated',
      `You were added to ${scheduleName}`,
      [userId]
    );

    revalidatePath(`/schedules/${assignment.scheduleId}`);
    revalidatePath('/schedules');
  } catch (error) {
    return scheduleActionError(error, 'Failed to add responder to the schedule.');
  }
}

export async function updateLayer(
  layerId: string,
  formData: FormData
): Promise<ScheduleFormState | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }
  const name = formData.get('name') as string;
  const start = formData.get('start') as string;
  const end = formData.get('end') as string;
  const rotationLength = Number(formData.get('rotationLengthHours'));
  const shiftLengthValue = formData.get('shiftLengthHours');
  const shiftLength = shiftLengthValue ? Number(shiftLengthValue) : null;

  const daysOfWeek = formData.getAll('daysOfWeek').map(Number);
  const restrictStartHour = formData.get('restrictStartHour');
  const restrictEndHour = formData.get('restrictEndHour');

  const startHourNum = restrictStartHour ? Number(restrictStartHour) : undefined;
  const endHourNum = restrictEndHour ? Number(restrictEndHour) : undefined;

  if (daysOfWeek.some(d => Number.isNaN(d) || d < 0 || d > 6)) {
    return scheduleValidationError('Days of week must be between 0 (Sun) and 6 (Sat).');
  }
  if (
    (startHourNum ?? 0) < 0 ||
    (startHourNum ?? 0) > 23 ||
    (endHourNum ?? 0) < 0 ||
    (endHourNum ?? 0) > 23
  ) {
    return scheduleValidationError('Hours must be between 0 and 23.');
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
    return scheduleValidationError(
      'Invalid layer data. Name, start date, and rotation length are required.'
    );
  }
  if (shiftLength !== null && (Number.isNaN(shiftLength) || shiftLength <= 0)) {
    return scheduleValidationError('Shift length must be greater than 0 hours.');
  }
  if (shiftLength !== null && shiftLength > rotationLength) {
    return scheduleValidationError('Shift length cannot exceed rotation length.');
  }

  const layerMeta = await prisma.onCallLayer.findUnique({
    where: { id: layerId },
    select: { scheduleId: true, schedule: { select: { timeZone: true } } },
  });

  if (!layerMeta) {
    return scheduleActionError(
      new AppError({
        code: 'SCHEDULE_LAYER_NOT_FOUND',
        userMessage: 'Layer not found.',
        details: { layerId },
      }),
      'Layer not found.'
    );
  }

  const startDate = parseDateTimeInTimeZone(start, layerMeta.schedule.timeZone);
  const endDate = end ? parseDateTimeInTimeZone(end, layerMeta.schedule.timeZone) : null;

  if (!startDate) {
    return scheduleValidationError('Invalid start date.');
  }
  if (end && !endDate) {
    return scheduleValidationError('Invalid end date.');
  }
  if (endDate && endDate <= startDate) {
    return scheduleValidationError('End date must be after start date.');
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
    return scheduleActionError(error, 'Failed to update layer.');
  }
}

export async function moveLayerUser(
  layerId: string,
  userId: string,
  direction: 'up' | 'down'
): Promise<ScheduleFormState | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }

  try {
    const result = await moveScheduleLayerUser(layerId, userId, direction);
    await logAudit({
      action: 'schedule.member.reordered',
      entityType: 'SCHEDULE',
      entityId: result.scheduleId,
      actorId,
      details: { layerId, userId, direction },
    });

    revalidatePath(`/schedules/${result.scheduleId}`);
    revalidatePath('/schedules');
  } catch (error) {
    return scheduleActionError(error, 'Failed to reorder responder.');
  }
}

export async function removeLayerUser(
  layerId: string,
  userId: string
): Promise<ScheduleFormState | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }

  try {
    const result = await removeScheduleLayerUser(layerId, userId);
    if (result.removed) {
      await logAudit({
        action: 'schedule.member.removed',
        entityType: 'SCHEDULE',
        entityId: result.scheduleId,
        actorId,
        details: { layerId, userId },
      });

      const scheduleName = await getScheduleName(result.scheduleId);
      await notifyScheduleMembers(
        result.scheduleId,
        'Schedule updated',
        `You were removed from ${scheduleName}`,
        [userId]
      );
    }

    revalidatePath(`/schedules/${result.scheduleId}`);
    revalidatePath('/schedules');
  } catch (error) {
    return scheduleActionError(error, 'Failed to remove responder from the schedule.');
  }
}

export async function createOverride(
  scheduleId: string,
  formData: FormData
): Promise<ScheduleFormState | undefined> {
  let actorId: string;
  try {
    actorId = (await assertCanCreateScheduleOverride(scheduleId)).id;
  } catch (error) {
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }

  const userId = (formData.get('userId') as string)?.trim();
  const replacesUserId = ((formData.get('replacesUserId') as string) || '').trim() || null;
  const start = formData.get('start') as string;
  const end = formData.get('end') as string;

  if (!userId || !start || !end) {
    return scheduleValidationError('User, start date, and end date are required.');
  }

  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { timeZone: true },
  });

  if (!schedule) {
    return scheduleActionError(
      new AppError({
        code: 'SCHEDULE_NOT_FOUND',
        userMessage: 'Schedule not found.',
        details: { scheduleId },
      }),
      'Schedule not found.'
    );
  }

  const startDate = parseDateTimeInTimeZone(start, schedule.timeZone);
  const endDate = parseDateTimeInTimeZone(end, schedule.timeZone);

  if (!startDate || !endDate) {
    return scheduleValidationError('Invalid date format.');
  }
  if (endDate <= startDate) {
    return scheduleValidationError('End date must be after start date.');
  }

  try {
    const override = await createScheduleOverrideMutation({
      scheduleId,
      userId,
      replacesUserId,
      start: startDate,
      end: endDate,
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
    return scheduleActionError(error, 'Failed to create schedule override.');
  }
}

export async function deleteOverride(
  scheduleId: string,
  overrideId: string
): Promise<ScheduleFormState | undefined> {
  let actorId: string;
  try {
    actorId = (await assertCanCreateScheduleOverride(scheduleId)).id;
  } catch (error) {
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }
  try {
    const override = await prisma.onCallOverride.findFirst({
      where: { id: overrideId, scheduleId },
      select: { userId: true, replacesUserId: true },
    });

    if (!override) {
      return scheduleActionError(
        new AppError({
          code: 'SCHEDULE_OVERRIDE_NOT_FOUND',
          userMessage: 'Override not found for this schedule.',
          details: { scheduleId, overrideId },
        }),
        'Override not found for this schedule.'
      );
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

    revalidatePath(`/schedules/${scheduleId}`);
  } catch (error) {
    return scheduleActionError(error, 'Failed to delete override.');
  }
}
