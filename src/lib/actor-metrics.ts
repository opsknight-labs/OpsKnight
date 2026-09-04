import 'server-only';

import type { AuthorizationActor } from '@/lib/authorization-policy';
import { actorMetricReadScope } from '@/lib/authorization-filters';
import { calculateSLAMetrics, type SLAMetricsFilter } from '@/lib/sla-server';
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
