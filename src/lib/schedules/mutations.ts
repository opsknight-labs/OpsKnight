import { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import { AppError } from '@/lib/errors';

type TransactionClient = Prisma.TransactionClient;

type LayerPosition = {
  id: string;
  userId: string;
  position: number;
};

function responderNotActiveError(userId: string, field: string) {
  const message = 'This responder is not active and cannot be assigned to an on-call schedule.';
  return new AppError({
    code: 'SCHEDULE_RESPONDER_NOT_ACTIVE',
    userMessage: message,
    action: 'Activate the responder or choose an active responder.',
    details: { userId },
    fields: [{ field, code: 'inactive_or_missing', message }],
  });
}

function overrideConflictError(details: Record<string, unknown>) {
  return new AppError({
    code: 'SCHEDULE_OVERRIDE_CONFLICT',
    userMessage: 'This override conflicts with an existing override for the same coverage period.',
    action: 'Choose a non-overlapping period or remove the existing override first.',
    details,
  });
}

async function requireActiveResponder(
  tx: TransactionClient,
  userId: string,
  field: string
): Promise<{ id: string; name: string }> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, status: true },
  });

  if (!user || user.status !== 'ACTIVE') {
    throw responderNotActiveError(userId, field);
  }

  return { id: user.id, name: user.name };
}

async function normalizeLayerPositions(
  tx: TransactionClient,
  layerId: string,
  entries?: LayerPosition[]
): Promise<LayerPosition[]> {
  const ordered =
    entries ??
    (await tx.onCallLayerUser.findMany({
      where: { layerId },
      select: { id: true, userId: true, position: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    }));

  const normalized = ordered.map((entry, index) => ({ ...entry, position: index + 1 }));
  for (const entry of normalized) {
    const persisted = ordered.find(candidate => candidate.id === entry.id);
    if (persisted?.position === entry.position) continue;
    await tx.onCallLayerUser.update({
      where: { id: entry.id },
      data: { position: entry.position },
    });
  }

  return normalized;
}

export async function addScheduleLayerUser(layerId: string, userId: string) {
  try {
    return await runSerializableTransaction(async tx => {
      const layer = await tx.onCallLayer.findUnique({
        where: { id: layerId },
        select: { id: true, name: true, scheduleId: true },
      });

      if (!layer) {
        throw new AppError({
          code: 'SCHEDULE_LAYER_NOT_FOUND',
          userMessage: 'Layer not found.',
          details: { layerId },
        });
      }

      const responder = await requireActiveResponder(tx, userId, 'userId');
      const existingAssignment = await tx.onCallLayerUser.findFirst({
        where: {
          userId,
          layer: { scheduleId: layer.scheduleId },
        },
        select: {
          layerId: true,
          layer: { select: { name: true } },
        },
      });

      if (existingAssignment) {
        const userMessage =
          existingAssignment.layerId === layerId
            ? `${responder.name} is already assigned to "${layer.name}".`
            : `${responder.name} is already assigned to "${existingAssignment.layer.name}" in this schedule. Remove them from that layer before adding them to "${layer.name}".`;

        throw new AppError({
          code: 'SCHEDULE_LAYER_USER_DUPLICATE',
          userMessage,
          details: {
            scheduleId: layer.scheduleId,
            requestedLayerId: layerId,
            existingLayerId: existingAssignment.layerId,
            userId,
          },
        });
      }

      const ordered = await normalizeLayerPositions(tx, layerId);
      const position = ordered.length + 1;
      const assignment = await tx.onCallLayerUser.create({
        data: { layerId, userId, position },
        select: { id: true, position: true },
      });

      return {
        scheduleId: layer.scheduleId,
        layerId,
        layerName: layer.name,
        userId,
        userName: responder.name,
        assignmentId: assignment.id,
        position: assignment.position,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError({
        code: 'SCHEDULE_LAYER_USER_DUPLICATE',
        userMessage: 'This responder is already assigned to this schedule.',
        details: { layerId, userId },
      });
    }
    throw error;
  }
}

export async function moveScheduleLayerUser(
  layerId: string,
  userId: string,
  direction: 'up' | 'down'
) {
  return runSerializableTransaction(async tx => {
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

    const users = await normalizeLayerPositions(tx, layerId);
    const current = users.find(entry => entry.userId === userId);
    if (!current) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Cannot move this responder in that direction.',
        details: { layerId, userId, direction },
      });
    }

    const targetPosition = direction === 'up' ? current.position - 1 : current.position + 1;
    const target = users.find(entry => entry.position === targetPosition);
    if (!target) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Cannot move this responder in that direction.',
        details: { layerId, userId, direction },
      });
    }

    await tx.onCallLayerUser.update({
      where: { id: current.id },
      data: { position: target.position },
    });
    await tx.onCallLayerUser.update({
      where: { id: target.id },
      data: { position: current.position },
    });

    return { scheduleId: layer.scheduleId, layerId, userId, direction };
  });
}

export async function removeScheduleLayerUser(layerId: string, userId: string) {
  return runSerializableTransaction(async tx => {
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

    const deletion = await tx.onCallLayerUser.deleteMany({
      where: { layerId, userId },
    });

    if (deletion.count > 0) {
      await normalizeLayerPositions(tx, layerId);
    }

    return {
      scheduleId: layer.scheduleId,
      layerId,
      userId,
      removed: deletion.count > 0,
    };
  });
}

export type CreateScheduleOverrideInput = {
  scheduleId: string;
  userId: string;
  replacesUserId: string | null;
  start: Date;
  end: Date;
};

export async function createScheduleOverrideMutation(input: CreateScheduleOverrideInput) {
  if (input.end <= input.start) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'End date must be after start date.',
      details: { scheduleId: input.scheduleId },
    });
  }

  if (input.replacesUserId && input.replacesUserId === input.userId) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'A responder cannot replace themselves in an override.',
      fields: [
        {
          field: 'replacesUserId',
          code: 'same_responder',
          message: 'Choose a different responder to replace.',
        },
      ],
    });
  }

  try {
    return await runSerializableTransaction(async tx => {
      const schedule = await tx.onCallSchedule.findUnique({
        where: { id: input.scheduleId },
        select: { id: true },
      });

      if (!schedule) {
        throw new AppError({
          code: 'SCHEDULE_NOT_FOUND',
          userMessage: 'Schedule not found.',
          details: { scheduleId: input.scheduleId },
        });
      }

      await requireActiveResponder(tx, input.userId, 'userId');
      if (input.replacesUserId) {
        await requireActiveResponder(tx, input.replacesUserId, 'replacesUserId');
      }

      const exactDuplicate = await tx.onCallOverride.findFirst({
        where: {
          scheduleId: input.scheduleId,
          userId: input.userId,
          start: input.start,
          end: input.end,
        },
        select: { id: true },
      });

      if (exactDuplicate) {
        throw overrideConflictError({
          scheduleId: input.scheduleId,
          existingOverrideId: exactDuplicate.id,
          userId: input.userId,
        });
      }

      if (input.replacesUserId) {
        const overlappingReplacement = await tx.onCallOverride.findFirst({
          where: {
            scheduleId: input.scheduleId,
            replacesUserId: input.replacesUserId,
            start: { lt: input.end },
            end: { gt: input.start },
          },
          select: { id: true, start: true, end: true },
        });

        if (overlappingReplacement) {
          throw overrideConflictError({
            scheduleId: input.scheduleId,
            replacesUserId: input.replacesUserId,
            existingOverrideId: overlappingReplacement.id,
            existingStart: overlappingReplacement.start.toISOString(),
            existingEnd: overlappingReplacement.end.toISOString(),
          });
        }
      }

      return tx.onCallOverride.create({
        data: {
          scheduleId: input.scheduleId,
          userId: input.userId,
          replacesUserId: input.replacesUserId,
          start: input.start,
          end: input.end,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw overrideConflictError({
        scheduleId: input.scheduleId,
        userId: input.userId,
        replacesUserId: input.replacesUserId,
      });
    }
    throw error;
  }
}
