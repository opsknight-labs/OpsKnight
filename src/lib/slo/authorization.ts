import type { Prisma } from '@prisma/client';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';

/** Workspace objectives require global metrics visibility; scoped actors see service objectives only. */
export function serviceObjectiveReadWhere(
  actor: AuthorizationActor
): Prisma.ServiceObjectiveWhereInput {
  if (hasCapability(actor.role, CAPABILITIES.METRICS_READ_ALL)) return {};
  return { serviceId: { not: null }, service: serviceReadWhere(actor) };
}
