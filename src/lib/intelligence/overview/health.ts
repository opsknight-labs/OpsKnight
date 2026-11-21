import 'server-only';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getIntelligenceHealthCheck, type LaneHealth } from '../metrics';
import { getWorkBacklog, type WorkBacklog } from '../jobs/work-queue';
import { withDbBudget } from '../jobs/db-budget';
import { OVERVIEW_SECTION_BUDGET } from './scope';

export interface OverviewHealth {
  lane: LaneHealth;
  backlog: WorkBacklog;
}

/**
 * Lane health of this instance and the shared work backlog. Operational detail for administrators only:
 * returns null for anyone without INTELLIGENCE_MANAGE so the page never even queries it for responders.
 */
export async function getOverviewHealth(actor: AuthorizationActor): Promise<OverviewHealth | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE)) return null;
  const backlog = await withDbBudget(OVERVIEW_SECTION_BUDGET, tx => getWorkBacklog(undefined, tx));
  return { lane: getIntelligenceHealthCheck(), backlog };
}
