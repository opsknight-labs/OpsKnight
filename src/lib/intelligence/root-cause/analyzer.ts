import 'server-only';
import type { Prisma } from '@prisma/client';
import { RESPONSE_LIMITS } from '../contract';
import { loadActiveEdges } from '../dependencies/service';
import { upstreamDistances } from '../dependencies/graph';
import type { FindingRow } from '../similarity/findings';
import { scoreCause, type CauseRelation, type ChangeKindValue } from './scoring';

export interface CauseFindings {
  changes: FindingRow[];
  upstreamIncidents: FindingRow[];
}

const MINUTE_MS = 60_000;

/**
 * Candidate causes for one incident: recent changes on the same or an upstream service (or global
 * changes), and incidents that opened on an upstream service shortly before. Every read is bounded
 * by a time window, a service set and a row cap. Evidence is numeric/enum only.
 */
export async function computeCauseFindings(
  tx: Prisma.TransactionClient,
  incident: { id: string; serviceId: string; createdAt: Date }
): Promise<CauseFindings> {
  const onset = incident.createdAt.getTime();
  const windowStart = new Date(onset - RESPONSE_LIMITS.causeLookbackMinutes * MINUTE_MS);
  const edges = await loadActiveEdges(tx);
  const upstream = upstreamDistances(edges, incident.serviceId, RESPONSE_LIMITS.maxUpstreamDepth);
  const serviceIds = [incident.serviceId, ...upstream.keys()];

  const [changes, upstreamIncidents] = await Promise.all([
    tx.changeEvent.findMany({
      where: {
        occurredAt: { gte: windowStart, lte: incident.createdAt },
        OR: [{ serviceId: { in: serviceIds } }, { serviceId: null }],
      },
      orderBy: { occurredAt: 'desc' },
      take: RESPONSE_LIMITS.maxCauseCandidates,
      select: { id: true, serviceId: true, kind: true, occurredAt: true },
    }),
    upstream.size === 0
      ? Promise.resolve([])
      : tx.incident.findMany({
          where: {
            id: { not: incident.id },
            serviceId: { in: [...upstream.keys()] },
            createdAt: { gte: windowStart, lte: incident.createdAt },
          },
          orderBy: { createdAt: 'desc' },
          take: RESPONSE_LIMITS.maxCauseCandidates,
          select: { id: true, serviceId: true, createdAt: true },
        }),
  ]);

  const changeRows = changes
    .map(change => {
      let relation: CauseRelation = 'GLOBAL';
      let depth = 0;
      if (change.serviceId === incident.serviceId) relation = 'SAME_SERVICE';
      else if (change.serviceId) {
        relation = 'UPSTREAM';
        depth = upstream.get(change.serviceId) ?? 1;
      }
      const leadSeconds = Math.round((onset - change.occurredAt.getTime()) / 1000);
      const score = scoreCause({ relation, depth, leadSeconds, kind: change.kind as ChangeKindValue });
      return { change, relation, depth, leadSeconds, score };
    })
    .filter(candidate => candidate.score.confidence > 0)
    .sort((a, b) => b.score.confidence - a.score.confidence || a.change.id.localeCompare(b.change.id))
    .slice(0, RESPONSE_LIMITS.maxCauseFindings)
    .map(candidate => ({
      confidence: candidate.score.confidence,
      subjectRef: candidate.change.id,
      evidence: {
        type: 'change',
        calibrated: false,
        kind: candidate.change.kind,
        relation: candidate.relation,
        depth: candidate.depth,
        leadSeconds: candidate.leadSeconds,
        components: { ...candidate.score.components },
      },
    }));

  const incidentRows = upstreamIncidents
    .map(other => {
      const depth = upstream.get(other.serviceId) ?? 1;
      const leadSeconds = Math.round((onset - other.createdAt.getTime()) / 1000);
      const score = scoreCause({ relation: 'UPSTREAM', depth, leadSeconds, kind: 'INCIDENT' });
      return { other, depth, leadSeconds, score };
    })
    .filter(candidate => candidate.score.confidence > 0)
    .sort((a, b) => b.score.confidence - a.score.confidence || a.other.id.localeCompare(b.other.id))
    .slice(0, RESPONSE_LIMITS.maxCauseFindings)
    .map(candidate => ({
      confidence: candidate.score.confidence,
      subjectRef: candidate.other.id,
      evidence: {
        type: 'upstream_incident',
        calibrated: false,
        depth: candidate.depth,
        leadSeconds: candidate.leadSeconds,
        components: { ...candidate.score.components },
      },
    }));

  return { changes: changeRows, upstreamIncidents: incidentRows };
}
