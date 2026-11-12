import 'server-only';
import type { Prisma } from '@prisma/client';
import type prisma from '@/lib/prisma';
import { RESPONSE_LIMITS, type ResponseWeights } from '../contract';
import type { FindingRow } from '../similarity/findings';
import { METRIC_EVIDENCE_GRACE_MINUTES } from './contract';
import { scoreMetricAnomaly } from './scoring';

type Reader = Prisma.TransactionClient | typeof prisma;

const MINUTE_MS = 60_000;

/** A deviation as a person reads it: "p99 latency deviated at 14:02 UTC by 7.3 MAD". */
export function describeDeviation(input: {
  templateName: string;
  at: Date;
  score: number;
  direction: string;
}): string {
  const time = input.at.toISOString().slice(11, 16);
  const arrow = input.direction === 'DOWN' ? 'dropped' : 'rose';
  return `${input.templateName} deviated at ${time} UTC by ${input.score.toFixed(1)} MAD (${arrow})`;
}

/**
 * Metric anomalies on the incident's service or its upstream services, from the cause window before onset to
 * a short grace after it, ranked as leads. One index-backed read on (serviceId, at), bounded like change
 * candidates; empty (and nearly free) when no template has ever produced an anomaly. Evidence is numeric.
 */
export async function computeMetricAnomalyFindings(
  tx: Reader,
  incident: { serviceId: string; createdAt: Date },
  upstream: ReadonlyMap<string, number>,
  weights?: ResponseWeights
): Promise<FindingRow[]> {
  const onset = incident.createdAt.getTime();
  const rows = await tx.metricAnomaly.findMany({
    where: {
      serviceId: { in: [incident.serviceId, ...upstream.keys()] },
      at: {
        gte: new Date(onset - RESPONSE_LIMITS.causeLookbackMinutes * MINUTE_MS),
        lte: new Date(onset + METRIC_EVIDENCE_GRACE_MINUTES * MINUTE_MS),
      },
    },
    orderBy: [{ at: 'desc' }, { id: 'asc' }],
    take: RESPONSE_LIMITS.maxCauseCandidates,
    select: {
      id: true,
      serviceId: true,
      at: true,
      score: true,
      direction: true,
      template: { select: { thresholdMad: true } },
    },
  });
  return rows
    .map(row => {
      const sameService = row.serviceId === incident.serviceId;
      const depth = sameService ? 0 : (upstream.get(row.serviceId) ?? 1);
      const leadSeconds = Math.round((onset - row.at.getTime()) / 1000);
      const score = scoreMetricAnomaly({
        relation: sameService ? 'SAME_SERVICE' : 'UPSTREAM',
        depth,
        leadSeconds,
        score: row.score,
        thresholdMad: row.template.thresholdMad,
        weights,
      });
      return { row, sameService, depth, leadSeconds, score };
    })
    .filter(candidate => candidate.score.confidence > 0)
    .sort((a, b) => b.score.confidence - a.score.confidence || a.row.id.localeCompare(b.row.id))
    .slice(0, RESPONSE_LIMITS.maxCauseFindings)
    .map(candidate => ({
      confidence: candidate.score.confidence,
      subjectRef: candidate.row.id,
      evidence: {
        type: 'metric_anomaly',
        calibrated: false,
        relation: candidate.sameService ? 'SAME_SERVICE' : 'UPSTREAM',
        depth: candidate.depth,
        leadSeconds: candidate.leadSeconds,
        madScore: Math.round(candidate.row.score * 100) / 100,
        direction: candidate.row.direction,
        components: { ...candidate.score.components },
      },
    }));
}

export interface MetricAnomalyAxisRow {
  id: string;
  at: Date;
  title: string;
  detail: string;
}

/**
 * Anomalies for the incident time axis: the given services (already filtered by what the viewer may read),
 * in the window. At most `limit` + 1 rows so the caller can tell it was truncated.
 */
export async function loadMetricAnomaliesForAxis(
  client: Reader,
  serviceIds: readonly string[],
  window: { start: Date; end: Date },
  limit: number
): Promise<MetricAnomalyAxisRow[]> {
  if (serviceIds.length === 0) return [];
  const rows = await client.metricAnomaly.findMany({
    where: { serviceId: { in: [...serviceIds] }, at: { gte: window.start, lte: window.end } },
    orderBy: [{ at: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    select: {
      id: true,
      at: true,
      score: true,
      direction: true,
      value: true,
      baselineMedian: true,
      template: { select: { name: true } },
      service: { select: { name: true } },
    },
  });
  return rows.map(row => ({
    id: row.id,
    at: row.at,
    title: describeDeviation({
      templateName: row.template.name,
      at: row.at,
      score: row.score,
      direction: row.direction,
    }),
    detail: `${row.service.name} · ${formatNumber(row.value)} vs usual ${formatNumber(row.baselineMedian)}`,
  }));
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return value.toExponential(2);
  return String(Math.round(value * 1000) / 1000);
}
