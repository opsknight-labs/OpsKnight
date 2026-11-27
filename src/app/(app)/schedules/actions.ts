'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import {
  assertAdmin,
  assertAdminOrResponder,
  assertCanCreateScheduleOverride,
} from '@/lib/rbac';
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
  deleteScheduleMutation,
  moveScheduleLayerUser,
  removeScheduleLayerUser,
  type ScheduleDependency,
} from '@/lib/schedules/mutations';
import { runSerializableTransaction } from '@/lib/db-utils';
import {
  createScheduleLayer,
  updateScheduleLayer,
  deleteScheduleLayer,
  reorderScheduleLayers,
  scheduleLayerUpdateSchema,
} from '@/lib/schedules/layer-commands';

type ScheduleFormState = ScheduleActionState;

async function getScheduleName(scheduleId: string) {
  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { name: true },
  });
  return schedule?.name || 'On-call schedule';
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
    await prisma.$transaction(async tx => {
      const schedule = await tx.onCallSchedule.create({
        data: { name: normalizedName, timeZone },
      });
      await logAudit(
        {
          action: 'schedule.created',
          entityType: 'SCHEDULE',
          entityId: schedule.id,
          actorId,
          details: { name: normalizedName, timeZone },
        },
        tx
      );
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
    const before = await prisma.onCallSchedule.findUnique({
      where: { id: scheduleId },
      select: { name: true, timeZone: true },
    });
    await prisma.$transaction(async tx => {
      await tx.onCallSchedule.update({
        where: { id: scheduleId },
        data: { name: normalizedName, timeZone },
      });
      await logAudit(
        {
          action: 'schedule.updated',
          entityType: 'SCHEDULE',
          entityId: scheduleId,
          actorId,
          details: { name: normalizedName, timeZone },
        },
        tx
      );
    });

    // Say what actually changed: a time zone change re-interprets every restriction and handoff.
    const changes = [
      before && before.name !== normalizedName
        ? `renamed from "${before.name}" to "${normalizedName}"`
        : null,
      before && before.timeZone !== timeZone
        ? `time zone changed from ${before.timeZone} to ${timeZone}, so restriction hours and handoffs now follow ${timeZone}`
        : null,
    ].filter((change): change is string => change !== null);
    if (changes.length > 0) {
      await notifyScheduleMembers(
        scheduleId,
        'Schedule updated',
        `Schedule "${normalizedName}" ${changes.join('; ')}`
      );
    }

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

/**
 * The bounds the API enforces on layer values (whole hours, at most a year, unique days), so a form
 * value like 1.5 hours is refused here instead of failing at the integer column.
 */
function checkLayerValues(values: {
  name: string;
  start: Date;
  end: Date | null;
  rotationLengthHours: number;
  shiftLengthHours: number | null;
  restrictions: { daysOfWeek?: number[]; startHour?: number; endHour?: number } | undefined;
}) {
  const parsed = scheduleLayerUpdateSchema.safeParse({
    ...values,
    start: values.start.toISOString(),
    end: values.end?.toISOString() ?? null,
    restrictions: values.restrictions ?? null,
  });
  if (parsed.success) return { error: undefined, values: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    error: scheduleValidationError(issue.message, [
      { field: issue.path.join('.'), code: issue.code, message: issue.message },
    ]),
    values: undefined,
  };
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
  const responderIds = Array.from(
    new Set(
      formData
        .getAll('responderIds')
        .map(value => String(value).trim())
        .filter(Boolean)
    )
  );

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
  const checked = checkLayerValues({
    name,
    start: startDate,
    end: endDate,
    rotationLengthHours: rotationLength,
    shiftLengthHours: shiftLength,
    restrictions,
  });
  if (checked.error) return checked.error;

  try {
    await runSerializableTransaction(async tx => {
      const created = await createScheduleLayer(
        tx, scheduleId,
        {
          name: checked.values.name, start: startDate, end: endDate,
          rotationLengthHours: checked.values.rotationLengthHours,
          shiftLengthHours: checked.values.shiftLengthHours,
          restrictions: restrictions ?? null,
        },
        responderIds
      );
      await logAudit({
        action: 'schedule.layer.created',
        entityType: 'SCHEDULE',
        entityId: scheduleId,
        actorId,
        details: { layerId: created.id, name },
      }, tx);
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
    const layer = await runSerializableTransaction(async tx => {
      const removed = await deleteScheduleLayer(tx, scheduleId, layerId);
      await logAudit({
        action: 'schedule.layer.deleted',
        entityType: 'SCHEDULE',
        entityId: scheduleId,
        actorId,
        details: { layerId, name: removed.name },
      }, tx);
      return removed;
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
    const assignment = await runSerializableTransaction(async tx => {
      const added = await addScheduleLayerUser(layerId, userId, tx);
      await logAudit(
        {
          action: 'schedule.member.added',
          entityType: 'SCHEDULE',
          entityId: added.scheduleId,
          actorId,
          details: { layerId, userId, position: added.position },
        },
        tx
      );
      return added;
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
  const checked = checkLayerValues({
    name,
    start: startDate,
    end: endDate,
    rotationLengthHours: rotationLength,
    shiftLengthHours: shiftLength,
    restrictions,
  });
  if (checked.error) return checked.error;

  try {
    await runSerializableTransaction(async tx => {
      await updateScheduleLayer(
        tx, layerMeta.scheduleId, layerId,
        {
          name: checked.values.name, start: startDate, end: endDate,
          rotationLengthHours: checked.values.rotationLengthHours,
          shiftLengthHours: checked.values.shiftLengthHours,
          restrictions: restrictions ?? null,
        }
      );
      await logAudit({
        action: 'schedule.layer.updated',
        entityType: 'SCHEDULE',
        entityId: layerMeta.scheduleId,
        actorId,
        details: { layerId, name },
      }, tx);
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

export async function moveLayerPrecedence(
  layerId: string,
  direction: 'higher' | 'lower'
): Promise<ScheduleFormState | undefined> {
  let actorId: string;
  try {
    actorId = (await assertAdminOrResponder()).id;
  } catch (error) {
    return scheduleActionError(error, 'Unauthorized. Admin or Responder access required.');
  }

  try {
    const result = await runSerializableTransaction(async tx => {
      const layer = await tx.onCallLayer.findUnique({
        where: { id: layerId },
        select: { scheduleId: true },
      });
      if (!layer) {
        throw new AppError({
          code: 'SCHEDULE_LAYER_NOT_FOUND',
          userMessage: 'Layer not found.',
          details: { layerId },
        });
      }
      await tx.$queryRaw`SELECT "id" FROM "OnCallSchedule" WHERE "id" = ${layer.scheduleId} FOR UPDATE`;

      const layers = await tx.onCallLayer.findMany({
        where: { scheduleId: layer.scheduleId },
        select: { id: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });
      const currentIndex = layers.findIndex(candidate => candidate.id === layerId);
      const targetIndex = direction === 'higher' ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= layers.length) {
        throw new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'This layer cannot be moved further in that direction.',
          details: { layerId, direction },
        });
      }

      const reordered = [...layers];
      const [movedLayer] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, movedLayer);
      const result = await reorderScheduleLayers(tx, layer.scheduleId, reordered.map(candidate => candidate.id));
      await logAudit({
        action: 'schedule.layer.precedence_updated',
        entityType: 'SCHEDULE',
        entityId: result.scheduleId,
        actorId,
        details: { layerId, direction },
      }, tx);
      return result;
    });
    revalidatePath(`/schedules/${result.scheduleId}`);
    revalidatePath('/schedules');
  } catch (error) {
    return scheduleActionError(error, 'Failed to update layer precedence.');
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
    const result = await runSerializableTransaction(async tx => {
      const moved = await moveScheduleLayerUser(layerId, userId, direction, tx);
      await logAudit(
        {
          action: 'schedule.member.reordered',
          entityType: 'SCHEDULE',
          entityId: moved.scheduleId,
          actorId,
          details: { layerId, userId, direction },
        },
        tx
      );
      return moved;
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
    const result = await runSerializableTransaction(async tx => {
      const removed = await removeScheduleLayerUser(layerId, userId, tx);
      if (removed.removed) {
        await logAudit(
          {
            action: 'schedule.member.removed',
            entityType: 'SCHEDULE',
            entityId: removed.scheduleId,
            actorId,
            details: { layerId, userId },
          },
          tx
        );
      }
      return removed;
    });
    if (result.removed) {
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
    await createScheduleOverrideMutation(
      { scheduleId, userId, replacesUserId, start: startDate, end: endDate },
      (tx, created) =>
        logAudit(
          {
            action: 'schedule.override.created',
            entityType: 'SCHEDULE',
            entityId: scheduleId,
            actorId,
            details: {
              overrideId: created.id,
              userId,
              replacesUserId,
              start: startDate.toISOString(),
              end: endDate.toISOString(),
            },
          },
          tx
        )
    );

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

    await prisma.$transaction(async tx => {
      await tx.onCallOverride.delete({ where: { id: overrideId } });
      await logAudit(
        {
          action: 'schedule.override.deleted',
          entityType: 'SCHEDULE',
          entityId: scheduleId,
          actorId,
          details: { overrideId, userId: override.userId, replacesUserId: override.replacesUserId },
        },
        tx
      );
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

export type DeleteScheduleResult = {
  success?: boolean;
  error?: string;
  code?: string;
  action?: string;
  retryable?: boolean;
  dependencies?: ScheduleDependency[];
};

export async function deleteSchedule(scheduleId: string): Promise<DeleteScheduleResult> {
  let actorId: string;
  try {
    actorId = (await assertAdmin()).id;
  } catch (error) {
    if (error instanceof AppError) {
      return {
        success: false,
        error: error.userMessage,
        code: error.code,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
      code: 'AUTHORIZATION_DENIED',
    };
  }

  try {
    await deleteScheduleMutation(scheduleId, actorId);

    revalidatePath('/schedules');
    revalidatePath('/audit');

    return { success: true };
  } catch (error) {
    if (error instanceof AppError && error.code === 'SCHEDULE_IN_USE') {
      return {
        success: false,
        error: error.userMessage,
        code: error.code,
        action: error.action,
        dependencies: (error.details?.dependencies as ScheduleDependency[]) || [],
      };
    }

    if (error instanceof AppError) {
      return {
        success: false,
        error: error.userMessage,
        code: error.code,
        action: error.action,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete schedule.',
    };
  }
}

