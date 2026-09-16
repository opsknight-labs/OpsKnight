import 'server-only';

import { ERASURE_DOMAIN_POLICY, type ErasureDomain } from './policy';
import { discoverSubjectErasureData } from './discover';

export interface ErasurePlanDomain extends ErasureDomain {
  count: number;
}

export interface SubjectErasurePlan {
  subjectId: string;
  generatedAt: string;
  domains: ErasurePlanDomain[];
  blockingConditions: string[];
  canExecute: boolean;
}

/**
 * Builds a preview of what erasing a subject would do: every domain from
 * policy.ts annotated with its current row count, plus any blocking
 * conditions that must be resolved first. Called both by the preview API
 * route and, again, immediately before execute() actually mutates anything —
 * so a plan is always re-validated against live data, never trusted stale.
 */
export async function buildSubjectErasurePlan(subjectId: string): Promise<SubjectErasurePlan> {
  const discovery = await discoverSubjectErasureData(subjectId);

  const domains: ErasurePlanDomain[] = ERASURE_DOMAIN_POLICY.map(domain => ({
    ...domain,
    count: discovery.domainCounts[domain.id] ?? 0,
  }));

  return {
    subjectId,
    generatedAt: new Date().toISOString(),
    domains,
    blockingConditions: discovery.blockingConditions,
    canExecute: discovery.blockingConditions.length === 0,
  };
}
