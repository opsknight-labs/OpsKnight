import 'server-only';

import type { AuthorizationActor } from '@/lib/authorization-policy';
import { actorMetricReadScope, incidentReadWhere } from '@/lib/authorization-filters';
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
  return calculateSLAMetrics({ ...filters, ...actorMetricReadScope(actor) });
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
