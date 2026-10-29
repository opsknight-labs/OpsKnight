import 'server-only';
import prisma from '@/lib/prisma';
import { withDbBudget } from '../jobs/db-budget';
import type { ClaimedWorkItem } from '../jobs/work-queue';
import { computeRunbookFindings } from '../recommendations/ranker';
import { computeCauseFindings } from '../root-cause/analyzer';
import { resolveEffectivePolicy, type IntelligenceSettingsView } from '../settings/service';
import { replaceFindings } from '../similarity/findings';
import { loadActiveEdges } from '../dependencies/service';

export type ResponseOutcome =
  'analyzed' | 'skipped_off' | 'skipped_disabled_feature' | 'incident_gone' | 'stale';

/** Cheap pre-check used by the indexer so no work item is created when response analysis is off. */
export async function shouldAnalyzeResponse(incidentId: string): Promise<boolean> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { serviceId: true },
  });
  if (!incident) return false;
  const policy = await resolveEffectivePolicy(incident.serviceId);
  return policy.effectiveMode !== 'OFF' && policy.definition.response.enabled;
}

/**
 * Computes probable causes (recent changes, upstream incidents) and runbook recommendations for one
 * incident. The effective policy gates all work; OFF (including the kill switch) means no queries
 * and no writes. All three finding kinds are written in one bounded transaction.
 */
export async function analyzeResponse(
  item: Pick<ClaimedWorkItem, 'subjectKey' | 'generation'>,
  settings: IntelligenceSettingsView
): Promise<ResponseOutcome> {
  const incidentId = item.subjectKey;
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { id: true, serviceId: true, createdAt: true },
  });
  if (!incident) return 'incident_gone';

  const policy = await resolveEffectivePolicy(incident.serviceId);
  if (policy.effectiveMode === 'OFF') return 'skipped_off';
  if (!policy.definition.response.enabled) return 'skipped_disabled_feature';
  const edges = await loadActiveEdges();

  return withDbBudget(settings, async tx => {
    // A newer analysis may already have written; fence all three kinds together so an older
    // run never leaves a mix of generations.
    const newest = await tx.intelligenceFinding.aggregate({
      where: {
        incidentId,
        kind: { in: ['CHANGE_CORRELATION', 'PROBABLE_CAUSE', 'RUNBOOK_RECOMMENDATION'] },
      },
      _max: { generation: true },
    });
    if ((newest._max.generation ?? 0) > item.generation) return 'stale' as const;
    const [causes, runbooks] = await Promise.all([
      computeCauseFindings(tx, incident, edges),
      computeRunbookFindings(tx, incident),
    ]);
    const common = { incidentId, generation: item.generation, policyVersion: policy.version };
    const results = [
      await replaceFindings(tx, { ...common, kind: 'CHANGE_CORRELATION', rows: causes.changes }),
      await replaceFindings(tx, {
        ...common,
        kind: 'PROBABLE_CAUSE',
        rows: causes.upstreamIncidents,
      }),
      await replaceFindings(tx, { ...common, kind: 'RUNBOOK_RECOMMENDATION', rows: runbooks }),
    ];
    return results.every(result => result === 'stale') ? 'stale' : 'analyzed';
  });
}
