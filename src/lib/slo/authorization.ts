import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';

/** Workspace objectives require global metrics visibility; scoped actors see their service objectives only.
 * Callers authorize the explicit objective scope before using this filter. Reuse role/team
 * visibility without demanding unrelated raw-service API scopes for aggregate-only access.
 */
export function serviceObjectiveReadWhere(
  actor: AuthorizationActor
): Prisma.ServiceObjectiveWhereInput {
  if (hasCapability(actor.role, CAPABILITIES.METRICS_READ_ALL)) return {};
  return { serviceId: { not: null }, service: serviceReadWhere({ ...actor, apiKey: undefined }) };
}

/** Shared daily snapshots include the whole service, including private incident contributions.
 * Scoped readers must use actor-filtered evaluations instead of this global aggregate history.
 */
export function requireSharedObjectiveHistory(actor: AuthorizationActor) {
  if (!hasCapability(actor.role, CAPABILITIES.METRICS_READ_ALL))
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage:
        'Shared objective history requires global metric visibility. Request an actor-scoped evaluation instead.',
    });
}
