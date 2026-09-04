import type { Prisma } from '@prisma/client';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';

export function getScheduleApiScope(actor: AuthorizationActor): Prisma.OnCallScheduleWhereInput {
  return scheduleReadWhere(actor);
}
