import 'server-only';
import prisma from '@/lib/prisma';
import { withDbBudget } from '../jobs/db-budget';
import { resolveEffectivePolicy, type IntelligenceSettingsView } from '../settings/service';
import type { ClaimedWorkItem } from '../jobs/work-queue';
import { replaceSimilarFindings } from './findings';
import { findSimilarIncidents } from './retrieval';

export const SIMILAR_RESULT_LIMIT = 5;

export type AnalysisOutcome = 'analyzed' | 'skipped_off' | 'skipped_disabled_feature' | 'incident_gone' | 'stale';

/**
 * Computes and stores similar-incident findings for one incident. The effective policy gates all
 * work: OFF (including the global kill switch) means no queries and no writes.
 */
export async function analyzeIncident(
  item: Pick<ClaimedWorkItem, 'subjectKey' | 'generation'>,
  settings: IntelligenceSettingsView
): Promise<AnalysisOutcome> {
  const incidentId = item.subjectKey;
  const fingerprint = await prisma.incidentFingerprint.findUnique({
    where: { incidentId },
    select: { serviceId: true },
  });
  if (!fingerprint) {
    const exists = await prisma.incident.findUnique({ where: { id: incidentId }, select: { id: true } });
    if (!exists) return 'incident_gone';
    // Indexing normally precedes analysis; a transient miss is retried with backoff.
    throw new Error('Incident fingerprint is not ready yet');
  }

  const policy = await resolveEffectivePolicy(fingerprint.serviceId);
  if (policy.effectiveMode === 'OFF') return 'skipped_off';
  if (!policy.definition.similarity.enabled) return 'skipped_disabled_feature';

  const similar = await findSimilarIncidents(incidentId, {
    candidateCap: settings.candidateCap,
    lookbackDays: settings.lookbackDays,
    minScore: policy.definition.similarity.minScore,
    limit: SIMILAR_RESULT_LIMIT,
    maxDbMs: settings.maxDbMs,
  });
  if (!similar) throw new Error('Incident fingerprint disappeared during analysis');

  const written = await withDbBudget(settings, tx =>
    replaceSimilarFindings(tx, {
      incidentId,
      generation: item.generation,
      policyVersion: policy.version,
      tier: similar.tier,
      results: similar.results,
    })
  );
  return written === 'stale' ? 'stale' : 'analyzed';
}
