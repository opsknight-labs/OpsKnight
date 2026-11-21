import 'server-only';
import type { IntelligenceFindingKind } from '@prisma/client';
import prisma from '@/lib/prisma';
import { cache } from 'react';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import { getIntelligenceSettings, resolveEffectivePolicy } from '../settings/service';
import { getCriticalBacklogLagMs } from '../jobs/backpressure';
import { MAX_WORK_ATTEMPTS, WORK_KINDS } from '../jobs/work-queue';
import { analysisPolicyHash, type IncidentAnalysisState } from './contract';

/** Recommendations only: grouping continues to use its native correlation lifecycle. */
export async function readIncidentAnalysisState(
  actor: AuthorizationActor,
  incidentId: string
): Promise<IncidentAnalysisState | null> {
  if (
    actor.status !== 'ACTIVE' ||
    actor.apiKey ||
    !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)
  )
    return null;
  const incident = await prisma.incident.findFirst({
    where: { AND: [{ id: incidentId }, incidentReadWhere(actor)] },
    select: {
      serviceId: true,
      updatedAt: true,
      intelligenceFingerprint: { select: { updatedAt: true, sourceUpdatedAt: true } },
    },
  });
  if (!incident) return null;
  const [policy, settings, snapshots, jobs] = await Promise.all([
    resolveEffectivePolicy(incident.serviceId),
    getIntelligenceSettings(),
    prisma.intelligenceAnalysisSnapshot.findMany({ where: { incidentId }, take: 6 }),
    prisma.intelligenceWorkItem.findMany({
      where: {
        subjectKey: incidentId,
        kind: {
          in: [
            WORK_KINDS.INDEX_INCIDENT,
            WORK_KINDS.ANALYZE_INCIDENT,
            WORK_KINDS.ANALYZE_RESPONSE,
            WORK_KINDS.CORRELATE_INCIDENT,
            WORK_KINDS.TRIAGE_INCIDENT,
          ],
        },
      },
      take: 5,
      select: { kind: true, generation: true, attempts: true, failedAt: true, scheduledAt: true },
    }),
  ]);
  const failed = jobs.some(job => job.failedAt || job.attempts >= MAX_WORK_ATTEMPTS);
  const canManage = hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);
  const base = {
    canRefresh: canManage && !failed && policy.effectiveMode !== 'OFF',
    ...(canManage ? { diagnosticsHref: '/settings/intelligence' } : {}),
  };
  if (policy.effectiveMode === 'OFF')
    return { ...base, status: 'OFF', message: 'Intelligence is off for this service.' };
  if (policy.effectiveMode === 'SHADOW')
    return {
      ...base,
      status: 'SHADOW',
      message: 'Shadow mode records analysis for evaluation. Suggestions appear in Suggest mode.',
    };
  const expected: IntelligenceFindingKind[] = [
    ...(policy.definition.similarity.enabled ? ['SIMILAR_INCIDENT' as const] : []),
    ...(policy.definition.response.enabled
      ? [
          'CHANGE_CORRELATION' as const,
          'PROBABLE_CAUSE' as const,
          'RUNBOOK_RECOMMENDATION' as const,
        ]
      : []),
    ...(policy.definition.triage.enabled && policy.definition.similarity.enabled
      ? [
          'TRIAGE_URGENCY' as const,
          'TRIAGE_ASSIGNMENT' as const,
          'TRIAGE_DUPLICATE' as const,
          'TRIAGE_RESOLUTION_TIME' as const,
        ]
      : []),
  ];
  if (expected.length === 0)
    return {
      ...base,
      status: 'CURRENT',
      canRefresh: false,
      message: 'Recommendation features are disabled in this service policy.',
    };
  const relevant = snapshots.filter(snapshot => expected.includes(snapshot.kind));
  const lastSuccessfulAt = relevant.length
    ? new Date(Math.min(...relevant.map(snapshot => +snapshot.completedAt))).toISOString()
    : undefined;
  const dated = { ...base, ...(lastSuccessfulAt ? { lastSuccessfulAt } : {}) };
  if (failed)
    return {
      ...dated,
      status: 'FAILED',
      message:
        'Analysis needs operator review. Earlier suggestions may still be useful, but have not been refreshed.',
    };
  if (jobs.length && (await getCriticalBacklogLagMs()) > settings.backpressureEscalationLagMs)
    return {
      ...dated,
      status: 'PAUSED',
      message: 'Analysis is yielding to paging work. Earlier suggestions have not been refreshed.',
    };
  if (relevant.length === 0 && incident.intelligenceFingerprint)
    return {
      ...dated,
      status: 'STALE',
      message:
        'No complete freshness record is available. Earlier suggestions, if shown, remain unverified until new analysis finishes.',
    };
  const pending = jobs.length > 0;
  const fresh =
    relevant.length === expected.length &&
    relevant.every(
      snapshot =>
        snapshot.sourceUpdatedAt?.getTime() === incident.updatedAt.getTime() &&
        incident.intelligenceFingerprint?.sourceUpdatedAt?.getTime() ===
          incident.updatedAt.getTime() &&
        snapshot.fingerprintUpdatedAt?.getTime() ===
          incident.intelligenceFingerprint?.updatedAt.getTime() &&
        snapshot.policyHash === analysisPolicyHash(policy) &&
        snapshot.engineVersion === INTELLIGENCE_ENGINE_VERSION
    );
  if (relevant.length && (!fresh || pending))
    return {
      ...dated,
      status: 'STALE',
      message: pending
        ? 'Refreshing recommendations. Earlier suggestions are shown until fresh analysis finishes.'
        : 'Recommendations have not been verified against the current incident and policy.',
    };
  if (!fresh || pending || !incident.intelligenceFingerprint)
    return {
      ...dated,
      status: 'WAITING',
      message:
        'Waiting for recommendation analysis. An empty panel does not mean analysis found no matches.',
      ...(jobs.length
        ? { retryAt: new Date(Math.min(...jobs.map(job => +job.scheduledAt))).toISOString() }
        : {}),
    };
  return {
    ...dated,
    status: 'CURRENT',
    message: expected.length
      ? 'Recommendations checked against the current incident and policy.'
      : 'Recommendation features are disabled in this service policy.',
  };
}

/** Deduplicate the status read across streamed cards in one server-rendered incident page. */
export const incidentAnalysisStateForRequest = cache(async (incidentId: string) => {
  try {
    return await readIncidentAnalysisState(await getCurrentAuthorizationActor(), incidentId);
  } catch {
    return {
      status: 'UNAVAILABLE' as const,
      message: 'Analysis is temporarily unavailable. Earlier suggestions have not been verified.',
      canRefresh: false,
    };
  }
});
