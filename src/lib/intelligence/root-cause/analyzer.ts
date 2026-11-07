import 'server-only';
import { Prisma, type ChangeEvent } from '@prisma/client';
import { RESPONSE_LIMITS, type ResponseWeights } from '../contract';
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
export const MAX_CHANGE_SOURCES = 32;
export const MAX_CHANGE_CANDIDATES_PER_SOURCE = 50;

/** A noisy emitter cannot consume the entire response-analysis candidate budget. */
async function recentChangeCandidates(
  tx: Prisma.TransactionClient,
  serviceIds: string[],
  since: Date,
  until: Date,
  global: boolean
) {
  const scope = global
    ? Prisma.sql`"serviceId" IS NULL`
    : Prisma.sql`"serviceId" IN (${Prisma.join(serviceIds)})`;
  return tx.$queryRaw<ChangeEvent[]>(Prisma.sql`
    WITH sources AS (
      SELECT "source", max("occurredAt") AS latest FROM "ChangeEvent"
      WHERE "occurredAt" >= ${since} AND "occurredAt" <= ${until} AND ${scope}
      GROUP BY "source" ORDER BY latest DESC, "source" ASC LIMIT ${MAX_CHANGE_SOURCES}
    )
    SELECT candidate.* FROM sources CROSS JOIN LATERAL (
      SELECT * FROM "ChangeEvent"
      WHERE "source" = sources."source" AND "occurredAt" >= ${since} AND "occurredAt" <= ${until}
        AND ${scope}
      ORDER BY "occurredAt" DESC, "id" DESC LIMIT ${MAX_CHANGE_CANDIDATES_PER_SOURCE}
    ) candidate
    ORDER BY candidate."occurredAt" DESC, candidate."id" DESC
  `);
}

/**
 * Candidate causes for one incident: recent changes on the same or an upstream service (or global
 * changes), and incidents that opened on an upstream service shortly before. Every read is bounded
 * by a time window, a service set and the caller's transaction budget. Evidence is numeric/enum only.
 */
export async function computeCauseFindings(
  tx: Prisma.TransactionClient,
  incident: { id: string; serviceId: string; createdAt: Date },
  knownEdges?: readonly DependencyEdge[],
  weights?: ResponseWeights
): Promise<CauseFindings> {
  const onset = incident.createdAt.getTime();
  const windowStart = new Date(onset - RESPONSE_LIMITS.causeLookbackMinutes * MINUTE_MS);
  const edges = knownEdges ?? (await loadActiveEdges(tx));
  const upstream = upstreamDistances(edges, incident.serviceId, RESPONSE_LIMITS.maxUpstreamDepth);
  const serviceIds = [incident.serviceId, ...upstream.keys()];

  // Separate scoped/global budgets preserve local evidence during a noisy global rollout.
  const [scopedChanges, globalChanges, upstreamIncidents, baselines, fingerprint] =
    await Promise.all([
      recentChangeCandidates(tx, serviceIds, windowStart, incident.createdAt, false),
      recentChangeCandidates(tx, serviceIds, windowStart, incident.createdAt, true),
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
        weights,
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
      const score = scoreCause({
        relation: 'UPSTREAM',
        depth,
        leadSeconds,
        kind: 'INCIDENT',
        weights,
      });
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
