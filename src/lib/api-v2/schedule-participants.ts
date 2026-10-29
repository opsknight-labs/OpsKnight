import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';

export const ScheduleLayerParams = z
  .object({
    id: z.string().trim().min(1).max(100),
    layerId: z.string().trim().min(1).max(100),
  })
  .strict();
export const ScheduleParticipantParams = ScheduleLayerParams.extend({
  userId: z.string().trim().min(1).max(100),
}).strict();

export async function requireScheduleLayer(
  tx: Prisma.TransactionClient,
  params: z.infer<typeof ScheduleLayerParams>
) {
  const layer = await tx.onCallLayer.findFirst({
    where: { id: params.layerId, scheduleId: params.id },
    select: { id: true },
  });
  if (!layer) throw new AppError({ code: 'SCHEDULE_LAYER_NOT_FOUND' });
  return layer;
}
