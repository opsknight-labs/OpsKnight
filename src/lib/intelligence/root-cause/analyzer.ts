import 'server-only';
import type { Prisma } from '@prisma/client';
import { RESPONSE_LIMITS } from '../contract';
import { loadActiveEdges } from '../dependencies/service';
import { upstreamDistances, type DependencyEdge } from '../dependencies/graph';
import type { FindingRow } from '../similarity/findings';
import { scoreCause, type CauseRelation, type ChangeKindValue } from './scoring';
import { loadChangeBaselines } from './baseline';

export interface CauseFindings {
  changes: FindingRow[];
  upstreamIncidents: FindingRow[];
}

const MINUTE_MS = 60_000;

/**
 * Candidate causes for one incident: recent changes on the same or an upstream service (or global
 * changes), and incidents that opened on an upstream service shortly before. Every read is bounded
 * by a time window, a service set and the caller's transaction budget. Evidence is numeric/enum only.
 */
export async function computeCauseFindings(
  tx: Prisma.TransactionClient,
  incident: { id: string; serviceId: string; createdAt: Date },
  knownEdges?: readonly DependencyEdge[]
): Promise<CauseFindings> {
  const onset = incident.createdAt.getTime();
  const windowStart = new Date(onset - RESPONSE_LIMITS.causeLookbackMinutes * MINUTE_MS);
  const edges = knownEdges ?? (await loadActiveEdges(tx));
  const upstream = upstreamDistances(edges, incident.serviceId, RESPONSE_LIMITS.maxUpstreamDepth);
  const serviceIds = [incident.serviceId, ...upstream.keys()];

  // Score every indexed candidate in the six-hour service/global window before taking top-k.
  // A recency limit here could hide an older, stronger cause behind a noisy change source.
  const changeWindow = { gte: windowStart, lte: incident.createdAt };
  const changeSelect = {
    id: true,
    serviceId: true,
    source: true,
    component: true,
    labels: true,
    kind: true,
    occurredAt: true,
  } as const;
  const [scopedChanges, globalChanges, upstreamIncidents, baselines, fingerprint] =
    await Promise.all([
      tx.changeEvent.findMany({
        where: { occurredAt: changeWindow, serviceId: { in: serviceIds } },
        orderBy: { occurredAt: 'desc' },
        select: changeSelect,
      }),
      tx.changeEvent.findMany({
        where: { occurredAt: changeWindow, serviceId: null },
        orderBy: { occurredAt: 'desc' },
        select: changeSelect,
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
      loadChangeBaselines(tx, serviceIds, incident.createdAt),
      tx.incidentFingerprint.findUnique({
        where: { incidentId: incident.id },
        select: { labels: true, tokens: true },
      }),
    ]);
  const labels =
    fingerprint?.labels &&
    typeof fingerprint.labels === 'object' &&
    !Array.isArray(fingerprint.labels)
      ? fingerprint.labels
      : {};

  const changeRows = [...scopedChanges, ...globalChanges]
    .map(change => {
      let relation: CauseRelation = 'GLOBAL';
      let depth = 0;
      if (change.serviceId === incident.serviceId) relation = 'SAME_SERVICE';
      else if (change.serviceId) {
        relation = 'UPSTREAM';
        depth = upstream.get(change.serviceId) ?? 1;
      }
      const leadSeconds = Math.round((onset - change.occurredAt.getTime()) / 1000);
      const baseline = baselines(change.source, change.serviceId);
      const changeLabels =
        change.labels && typeof change.labels === 'object' && !Array.isArray(change.labels)
          ? change.labels
          : {};
      const comparisons = Object.entries(changeLabels).flatMap(([key, value]) => {
        const found = Object.entries(labels).find(([label]) => label === key);
        return found ? [Number(found[1] === value)] : [];
      });
      if (change.component) {
        const named = Object.entries(labels).find(([key]) =>
          ['component', 'app', 'application', 'workload'].includes(key)
        );
        if (named) comparisons.push(Number(named[1] === change.component));
        else if (fingerprint?.tokens.includes(change.component)) comparisons.push(1);
      }
      const componentMatch = comparisons.length
        ? comparisons.reduce((a, b) => a + b, 0) / comparisons.length
        : undefined;
      const score = scoreCause({
        relation,
        depth,
        leadSeconds,
        kind: change.kind as ChangeKindValue,
        chanceFactor: baseline.factor,
        componentMatch,
      });
      return { change, relation, depth, leadSeconds, score, baseline, componentMatch };
    })
    .filter(candidate => candidate.score.confidence > 0)
    .sort(
      (a, b) => b.score.confidence - a.score.confidence || a.change.id.localeCompare(b.change.id)
    )
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
        baselineChanges: candidate.baseline.count,
        chanceFactor: candidate.baseline.factor,
        ...(candidate.componentMatch !== undefined
          ? { componentMatch: candidate.componentMatch }
          : {}),
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
