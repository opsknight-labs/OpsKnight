import 'server-only';
import { analysisPolicyHash } from '../analysis/contract';
import prisma from '@/lib/prisma';
import { observeOperationalHistogram } from '@/lib/metrics/operational/registry';
import { withDbBudget } from '../jobs/db-budget';
import { resolveEffectivePolicy, type IntelligenceSettingsView } from '../settings/service';
import { enqueueWorkItems, WORK_KINDS, type ClaimedWorkItem } from '../jobs/work-queue';
import { replaceSimilarFindings } from './findings';
import { findSimilarIncidents } from './retrieval';
import { currentEmbeddingModel } from '../semantic/embedder';

/** Stored per incident. More than are shown, so a viewer who cannot see some precedents still gets some. */
export const SIMILAR_RESULT_LIMIT = 10;

export type AnalysisOutcome =
  'analyzed' | 'skipped_off' | 'skipped_disabled_feature' | 'incident_gone' | 'stale';

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
    select: { serviceId: true, updatedAt: true, sourceUpdatedAt: true, incidentCreatedAt: true },
  });
  if (!fingerprint) {
    const exists = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { id: true },
    });
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
    semanticModel: await currentEmbeddingModel().catch(() => null),
    weights: policy.definition.similarity.weights,
  });
  if (!similar) throw new Error('Incident fingerprint disappeared during analysis');

  const { written, first } = await withDbBudget(settings, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-finding:SIMILAR_INCIDENT:${incidentId}`}, 0))`;
    const previous = await tx.intelligenceAnalysisSnapshot.findUnique({
      where: { incidentId_kind: { incidentId, kind: 'SIMILAR_INCIDENT' } },
      select: { incidentId: true },
    });
    const written = await replaceSimilarFindings(tx, {
      incidentId,
      generation: item.generation,
      policyVersion: policy.version,
      policyHash: analysisPolicyHash(policy),
      sourceUpdatedAt: fingerprint.sourceUpdatedAt ?? undefined,
      fingerprintUpdatedAt: fingerprint.updatedAt,
      tier: similar.tier,
      results: similar.results,
    });
    // Triage votes over the precedents just written, so it is chained here rather than at indexing.
    if (written === 'written' && policy.definition.triage.enabled)
      await enqueueWorkItems([{ kind: WORK_KINDS.TRIAGE_INCIDENT, subjectKey: incidentId }], tx);
    return { written, first: !previous };
  });
  if (first && written === 'written') {
    const age = Math.max(0, (Date.now() - fingerprint.incidentCreatedAt.getTime()) / 1000);
    observeOperationalHistogram('opsknight_intelligence_time_to_first_insight_seconds', age, {
      origin: age < 3600 ? 'live' : 'backfill',
    });
  }
  return written === 'stale' ? 'stale' : 'analyzed';
}
