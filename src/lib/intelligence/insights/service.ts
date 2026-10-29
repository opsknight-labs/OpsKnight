import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { MAX_WORK_ATTEMPTS } from '../jobs/work-queue';
import { resolveEffectivePolicy } from '../settings/service';
import {
  ANOMALY_BASELINE_WEEKS,
  ANOMALY_RECENT_DAYS,
  detectRateAnomaly,
  type RateAnomaly,
} from './anomaly';
import {
  bucketVerdicts,
  suggestMinScore,
  type MinScoreSuggestion,
  type ScoreBucket,
} from './calibration';

const DAY_MS = 86_400_000;
export const RECURRING_WINDOW_DAYS = 30;
export const RECURRING_MIN_OCCURRENCES = 3;
export const RECURRING_MIN_DISTINCT_DAYS = 2;
const MAX_FEEDBACK_ROWS = 5_000;
const MAX_SERVICES = 2_000;
const MAX_LIST = 10;

export interface RecurringProblem {
  serviceId: string;
  serviceName: string;
  /** Masked incident title shared by every occurrence. */
  template: string;
  occurrences: number;
  distinctDays: number;
  lastSeenAt: Date;
  latestIncidentId: string;
  /** Whether any enabled runbook is attached to the service. */
  hasRunbook: boolean;
}

export interface RateAnomalyRow extends RateAnomaly {
  serviceId: string;
  serviceName: string;
}

export interface FeedbackCalibration {
  votes: number;
  helpful: number;
  buckets: ScoreBucket[];
  currentMinScore: number;
  suggestion: MinScoreSuggestion | null;
}

export interface WeeklySummary {
  windowDays: number;
  incidentsAnalyzed: number;
  findingsByKind: Record<string, number>;
  ratings: number;
  helpfulRatings: number;
  changesRecorded: number;
  deadLetters: number;
}

export interface InsightsView {
  weekly: WeeklySummary | null;
  recurring: RecurringProblem[];
  anomalies: RateAnomalyRow[];
  calibration: FeedbackCalibration | null;
}

async function visibleServices(actor: AuthorizationActor, client: typeof prisma) {
  let where: Prisma.ServiceWhereInput;
  try {
    where = serviceReadWhere(actor);
  } catch {
    return new Map<string, string>();
  }
  const rows = await client.service.findMany({
    where,
    take: MAX_SERVICES,
    select: { id: true, name: true },
  });
  return new Map(rows.map(row => [row.id, row.name]));
}

async function recurringProblems(
  serviceIds: string[],
  now: Date,
  client: typeof prisma
): Promise<Omit<RecurringProblem, 'serviceName'>[]> {
  if (serviceIds.length === 0) return [];
  const since = new Date(now.getTime() - RECURRING_WINDOW_DAYS * DAY_MS);
  const rows = await client.$queryRaw<
    Array<{
      serviceId: string;
      template: string;
      occurrences: number;
      days: number;
      lastSeen: Date;
      latest: string;
    }>
  >(Prisma.sql`
    SELECT "serviceId", "template",
           count(*)::int AS occurrences,
           count(DISTINCT date_trunc('day', "incidentCreatedAt"))::int AS days,
           max("incidentCreatedAt") AS "lastSeen",
           (array_agg("incidentId" ORDER BY "incidentCreatedAt" DESC))[1] AS latest
    FROM "IncidentFingerprint"
    WHERE "incidentCreatedAt" >= ${since} AND "serviceId" = ANY(${serviceIds}) AND "template" <> ''
    GROUP BY "serviceId", "template"
    HAVING count(*) >= ${RECURRING_MIN_OCCURRENCES}
       AND count(DISTINCT date_trunc('day', "incidentCreatedAt")) >= ${RECURRING_MIN_DISTINCT_DAYS}
    ORDER BY count(*) DESC, max("incidentCreatedAt") DESC
    LIMIT ${MAX_LIST}
  `);
  if (rows.length === 0) return [];
  const bound = await client.serviceAutomationRule.findMany({
    where: {
      serviceId: { in: [...new Set(rows.map(row => row.serviceId))] },
      enabled: true,
      detachedAt: null,
    },
    select: { serviceId: true },
    distinct: ['serviceId'],
  });
  const withRunbook = new Set(bound.map(row => row.serviceId));
  return rows.map(row => ({
    serviceId: row.serviceId,
    template: row.template,
    occurrences: row.occurrences,
    distinctDays: row.days,
    lastSeenAt: row.lastSeen,
    latestIncidentId: row.latest,
    hasRunbook: withRunbook.has(row.serviceId),
  }));
}

async function rateAnomalies(
  serviceIds: string[],
  now: Date,
  client: typeof prisma
): Promise<Array<RateAnomaly & { serviceId: string }>> {
  if (serviceIds.length === 0) return [];
  const recentStart = new Date(now.getTime() - ANOMALY_RECENT_DAYS * DAY_MS);
  const baselineStart = new Date(recentStart.getTime() - ANOMALY_BASELINE_WEEKS * 7 * DAY_MS);
  const rows = await client.$queryRaw<
    Array<{ serviceId: string; recent: number; baseline: number }>
  >(Prisma.sql`
    SELECT "serviceId",
           count(*) FILTER (WHERE "createdAt" >= ${recentStart})::int AS recent,
           count(*) FILTER (WHERE "createdAt" < ${recentStart})::int AS baseline
    FROM "Incident"
    WHERE "createdAt" >= ${baselineStart} AND "serviceId" = ANY(${serviceIds})
    GROUP BY "serviceId"
    HAVING count(*) FILTER (WHERE "createdAt" >= ${recentStart}) > 0
  `);
  const flagged: Array<RateAnomaly & { serviceId: string }> = [];
  for (const row of rows) {
    const anomaly = detectRateAnomaly(row.recent, row.baseline);
    if (anomaly) flagged.push({ serviceId: row.serviceId, ...anomaly });
  }
  return flagged.sort((a, b) => b.ratio - a.ratio || b.recent - a.recent).slice(0, MAX_LIST);
}

export async function getFeedbackCalibration(
  client: typeof prisma = prisma
): Promise<FeedbackCalibration> {
  const rows = await client.$queryRaw<Array<{ confidence: number; verdict: string }>>(Prisma.sql`
    SELECT f."confidence", fb."verdict"::text AS verdict
    FROM "IntelligenceFeedback" fb
    JOIN "IntelligenceFinding" f ON f."id" = fb."subjectId"
    WHERE fb."subjectType" = 'FINDING' AND f."kind" = 'SIMILAR_INCIDENT'
      AND fb."verdict" IN ('HELPFUL', 'NOT_HELPFUL')
    ORDER BY fb."createdAt" DESC
    LIMIT ${MAX_FEEDBACK_ROWS}
  `);
  const global = await resolveEffectivePolicy(null, client);
  const verdicts = rows.map(row => ({ score: row.confidence, helpful: row.verdict === 'HELPFUL' }));
  const currentMinScore = global.definition.similarity.minScore;
  return {
    votes: verdicts.length,
    helpful: verdicts.filter(verdict => verdict.helpful).length,
    buckets: bucketVerdicts(verdicts),
    currentMinScore,
    suggestion: suggestMinScore(verdicts, currentMinScore),
  };
}

export const WEEKLY_WINDOW_DAYS = 7;

/** Aggregate counts only: no titles, no ids, nothing that names a service, so it is safe at any scope. */
export async function getWeeklySummary(
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<WeeklySummary> {
  const since = new Date(now.getTime() - WEEKLY_WINDOW_DAYS * DAY_MS);
  const [findings, analyzed, ratings, changes, dead] = await Promise.all([
    client.intelligenceFinding.groupBy({
      by: ['kind'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    // Counted in the database; pulling distinct ids into the process grew with every incident.
    client.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(DISTINCT "incidentId") AS count FROM "IntelligenceFinding" WHERE "createdAt" >= ${since}`,
    client.intelligenceFeedback.groupBy({
      by: ['verdict'],
      where: { createdAt: { gte: since }, verdict: { in: ['HELPFUL', 'NOT_HELPFUL'] } },
      _count: { _all: true },
    }),
    client.changeEvent.count({ where: { createdAt: { gte: since } } }),
    client.intelligenceWorkItem.count({ where: { attempts: { gte: MAX_WORK_ATTEMPTS } } }),
  ]);
  const helpful = ratings.find(row => row.verdict === 'HELPFUL')?._count._all ?? 0;
  const notHelpful = ratings.find(row => row.verdict === 'NOT_HELPFUL')?._count._all ?? 0;
  return {
    windowDays: WEEKLY_WINDOW_DAYS,
    incidentsAnalyzed: Number(analyzed[0]?.count ?? 0),
    findingsByKind: Object.fromEntries(findings.map(row => [row.kind, row._count._all])),
    ratings: helpful + notHelpful,
    helpfulRatings: helpful,
    changesRecorded: changes,
    deadLetters: dead,
  };
}

/**
 * Operational insights for people who administer intelligence. Everything is flag-only and computed on
 * demand from bounded queries, so there is no background job to fail or fall behind. Service-level
 * results are limited to the services the viewer may read; the feedback calibration is aggregate
 * and names nothing.
 */
export async function getInsights(
  actor: AuthorizationActor,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<InsightsView | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ)) return null;
  const services = await visibleServices(actor, client);
  const ids = [...services.keys()];
  const [weekly, recurring, anomalies, calibration] = await Promise.all([
    hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE)
      ? getWeeklySummary(now, client)
      : Promise.resolve(null),
    recurringProblems(ids, now, client),
    rateAnomalies(ids, now, client),
    // Aggregate feedback is only shown to someone who can see every service, so it cannot reveal
    // anything about a service outside a scoped viewer's reach.
    hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE)
      ? getFeedbackCalibration(client)
      : Promise.resolve(null),
  ]);
  return {
    weekly,
    recurring: recurring.map(row => ({
      ...row,
      serviceName: services.get(row.serviceId) ?? row.serviceId,
    })),
    anomalies: anomalies.map(row => ({
      ...row,
      serviceName: services.get(row.serviceId) ?? row.serviceId,
    })),
    calibration,
  };
}
