import { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';

const layerValuesSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    start: z.string().datetime(),
    end: z.string().datetime().nullable(),
    rotationLengthHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365),
    shiftLengthHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .nullable(),
    restrictions: z
      .object({
        daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
        startHour: z.number().int().min(0).max(23).optional(),
        endHour: z.number().int().min(0).max(23).optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();

function validateLayerValues(value: z.infer<typeof layerValuesSchema>, ctx: z.RefinementCtx) {
  if (value.end && new Date(value.end) <= new Date(value.start)) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'End must follow start.' });
  }
  if (value.shiftLengthHours !== null && value.shiftLengthHours > value.rotationLengthHours) {
    ctx.addIssue({
      code: 'custom',
      path: ['shiftLengthHours'],
      message: 'Shift length cannot exceed rotation length.',
    });
  }
  if (
    value.restrictions?.daysOfWeek &&
    new Set(value.restrictions.daysOfWeek).size !== value.restrictions.daysOfWeek.length
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['restrictions', 'daysOfWeek'],
      message: 'Days of week must be unique.',
    });
  }
}

export const scheduleLayerUpdateSchema = layerValuesSchema.superRefine(validateLayerValues);
export const scheduleLayerBodySchema = layerValuesSchema
  .extend({
    responderIds: z.array(z.string().trim().min(1).max(100)).max(100),
  })
  .superRefine((value, ctx) => {
    validateLayerValues(value, ctx);
    if (new Set(value.responderIds).size !== value.responderIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['responderIds'],
        message: 'Responders must be unique.',
      });
    }
  });

export type ScheduleLayerValues = {
  name: string;
  start: Date;
  end: Date | null;
  rotationLengthHours: number;
  shiftLengthHours: number | null;
  restrictions: Prisma.InputJsonValue | null;
};

export async function createScheduleLayer(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  values: ScheduleLayerValues,
  responderIds: string[]
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule-layer:${scheduleId}`}, 0))`;
  const schedule = await tx.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { id: true },
  });
  if (!schedule) throw new AppError({ code: 'SCHEDULE_NOT_FOUND' });
  if (responderIds.length > 100 || new Set(responderIds).size !== responderIds.length) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Choose at most 100 distinct responders.',
    });
  }
  const layerCount = await tx.onCallLayer.count({ where: { scheduleId } });
  if (layerCount >= 100) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'A schedule can have at most 100 layers.',
    });
  }
  if (responderIds.length) {
    const active = await tx.user.count({ where: { id: { in: responderIds }, status: 'ACTIVE' } });
    if (active !== responderIds.length)
      throw new AppError({ code: 'SCHEDULE_RESPONDER_NOT_ACTIVE' });
    const assigned = await tx.onCallLayerUser.findFirst({
      where: { userId: { in: responderIds }, layer: { scheduleId } },
      select: { id: true },
    });
    if (assigned) throw new AppError({ code: 'SCHEDULE_LAYER_USER_DUPLICATE' });
  }
  const lowest = await tx.onCallLayer.findFirst({
    where: { scheduleId },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    select: { priority: true },
  });
  const layer = await tx.onCallLayer.create({
    data: {
      scheduleId,
      ...values,
      restrictions: values.restrictions ?? undefined,
      priority: lowest ? lowest.priority - 1 : 0,
      users: responderIds.length
        ? { create: responderIds.map((userId, index) => ({ userId, position: index + 1 })) }
        : undefined,
    },
    select: { id: true },
  });
  return tx.onCallLayer.findUniqueOrThrow({
    where: { id: layer.id },
    include: { users: { orderBy: { position: 'asc' }, select: { userId: true, position: true } } },
  });
}

export async function updateScheduleLayer(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  layerId: string,
  values: ScheduleLayerValues,
  expectedRevision?: number
) {
  const existing = await tx.onCallLayer.findFirst({
    where: { id: layerId, scheduleId },
    select: { id: true, revision: true },
  });
  if (!existing) throw new AppError({ code: 'SCHEDULE_LAYER_NOT_FOUND' });
  if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  }
  const result = await tx.onCallLayer.updateMany({
    where: {
      id: layerId,
      scheduleId,
      ...(expectedRevision === undefined ? {} : { revision: expectedRevision }),
    },
    data: {
      ...values,
      restrictions: values.restrictions === null ? Prisma.DbNull : values.restrictions,
    },
  });
  if (result.count !== 1) throw new AppError({ code: 'PRECONDITION_FAILED' });
  return tx.onCallLayer.findUniqueOrThrow({
    where: { id: layerId },
    include: { users: { orderBy: { position: 'asc' }, select: { userId: true, position: true } } },
  });
}

export async function deleteScheduleLayer(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  layerId: string,
  expectedRevision?: number
) {
  await tx.$queryRaw`SELECT "id" FROM "OnCallLayer" WHERE "id" = ${layerId} AND "scheduleId" = ${scheduleId} FOR UPDATE`;
  const existing = await tx.onCallLayer.findFirst({
    where: { id: layerId, scheduleId },
    select: { id: true, name: true, revision: true },
  });
  if (!existing) throw new AppError({ code: 'SCHEDULE_LAYER_NOT_FOUND' });
  if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  }
  await tx.onCallLayerUser.deleteMany({ where: { layerId } });
  const result = await tx.onCallLayer.deleteMany({ where: { id: layerId, scheduleId } });
  if (result.count !== 1) throw new AppError({ code: 'PRECONDITION_FAILED' });
  return existing;
}

export async function reorderScheduleLayers(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  orderedIds: string[],
  expectedScheduleRevision?: number
) {
  if (orderedIds.length > 100 || new Set(orderedIds).size !== orderedIds.length) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Layer order must contain at most 100 distinct IDs.',
    });
  }
  await tx.$queryRaw`SELECT "id" FROM "OnCallSchedule" WHERE "id" = ${scheduleId} FOR UPDATE`;
  const schedule = await tx.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { id: true, revision: true },
  });
  if (!schedule) throw new AppError({ code: 'SCHEDULE_NOT_FOUND' });
  if (expectedScheduleRevision !== undefined && schedule.revision !== expectedScheduleRevision) {
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  }
  const layers = await tx.onCallLayer.findMany({
    where: { scheduleId },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, priority: true },
  });
  if (layers.length !== orderedIds.length || layers.some(layer => !orderedIds.includes(layer.id))) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Layer order must include every current layer exactly once.',
    });
  }
  for (const [index, id] of orderedIds.entries()) {
    const priority = orderedIds.length - index;
    const current = layers.find(layer => layer.id === id);
    if (current?.priority !== priority) {
      await tx.onCallLayer.update({ where: { id }, data: { priority } });
    }
  }
  const updated = await tx.onCallSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
    select: { revision: true },
  });
  return { scheduleId, revision: updated.revision, orderedIds };
}
