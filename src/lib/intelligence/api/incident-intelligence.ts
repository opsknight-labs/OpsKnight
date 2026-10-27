import 'server-only';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getRelatedIncidentsForActor } from '../correlation/view';
import { getResponseIntelligenceForActor } from '../response/view';
import { getSimilarIncidentsForActor } from '../similarity/view';

const iso = (date: Date) => date.toISOString();

/**
 * The incident's intelligence as the caller may see it, for the REST API. It reuses the same
 * actor-scoped views as the web UI, so the API can never reveal an incident, change or runbook the
 * caller could not open themselves. Everything is advisory and every score is an uncalibrated ranking
 * signal, which the response states.
 */
export async function buildIncidentIntelligence(incidentId: string, actor: AuthorizationActor) {
  const [similar, related, response] = await Promise.all([
    getSimilarIncidentsForActor(incidentId, actor),
    getRelatedIncidentsForActor(incidentId, actor),
    getResponseIntelligenceForActor(incidentId, actor),
  ]);
  return {
    incidentId,
    advisory: true as const,
    calibrated: false as const,
    similarIncidents: (similar ?? []).map(item => ({
      incidentId: item.incidentId,
      title: item.title,
      status: item.status,
      serviceName: item.serviceName,
      createdAt: iso(item.createdAt),
      resolvedAt: item.resolvedAt ? iso(item.resolvedAt) : null,
      matchPercent: item.matchPercent,
      reasons: item.reasons,
    })),
    relatedIncidents: (related ?? []).map(item => ({
      incidentId: item.incidentId,
      title: item.title,
      status: item.status,
      serviceName: item.serviceName,
      createdAt: iso(item.createdAt),
      decision: item.decision,
      origin: item.origin,
      ruleId: item.ruleId,
    })),
    possibleChanges: (response?.changes ?? []).map(item => ({
      changeId: item.changeId,
      kind: item.kind,
      summary: item.summary,
      source: item.source,
      version: item.version,
      url: item.url,
      serviceName: item.serviceName,
      occurredAt: iso(item.occurredAt),
      leadMinutes: item.leadMinutes,
      relation: item.relation,
      confidencePercent: item.confidencePercent,
    })),
    upstreamIncidents: (response?.upstreamIncidents ?? []).map(item => ({
      incidentId: item.incidentId,
      title: item.title,
      status: item.status,
      serviceName: item.serviceName,
      leadMinutes: item.leadMinutes,
      confidencePercent: item.confidencePercent,
    })),
    runbooks: (response?.runbooks ?? []).map(item => ({
      runbookId: item.runbookId,
      name: item.name,
      succeededRuns: item.succeeded,
      completedRuns: item.eligible,
      attachedToService: item.bound,
    })),
  };
}
