import 'server-only';

import type { Prisma } from '@prisma/client';
import {
  actorMetricReadScope,
  incidentReadWhere,
  scheduleReadWhere,
} from '@/lib/authorization-filters';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import {
  calculateMultiServiceUptime,
  calculateSLAMetrics,
  type SLAMetricsFilter,
} from '@/lib/sla-server';
import type { SLAMetrics } from '@/lib/sla';

/**
 * User-facing metrics boundary. It is deliberately actor-first so callers
 * cannot execute analytics and then attempt to filter unauthorized rows.
 */
export function calculateActorSLAMetrics(
  actor: AuthorizationActor,
  filters: SLAMetricsFilter = {}
): Promise<SLAMetrics> {
  return calculateSLAMetrics({
    ...filters,
    ...actorMetricReadScope(actor),
    scheduleScope: actorScheduleScope(actor),
  });
}

/** Schedules whose on-call data the actor may see in analytics; none without schedule access. */
function actorScheduleScope(actor: AuthorizationActor): Prisma.OnCallScheduleWhereInput {
  return authorize({ actor, action: AUTHORIZATION_ACTIONS.SCHEDULE_READ }).allowed
    ? scheduleReadWhere(actor)
    : { id: { in: [] } };
}

/** Authenticated uptime boundary; public status pages use the unscoped helper. */
export function calculateActorMultiServiceUptime(
  actor: AuthorizationActor,
  serviceIds: string[],
  startDate: Date,
  endDate: Date = new Date()
): Promise<Record<string, number>> {
  return calculateMultiServiceUptime(serviceIds, startDate, endDate, {
    incidentWhere: incidentReadWhere(actor),
  });
}
