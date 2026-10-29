import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceReadWhere, incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { MAX_WORK_ATTEMPTS } from '../jobs/work-queue';
import { withDbBudget } from '../jobs/db-budget';
import { resolveEffectivePolicy } from '../settings/service';
import {
  ANOMALY_BASELINE_WEEKS,
  ANOMALY_RECENT_DAYS,
  detectSeasonalAnomaly,
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
type Client = Prisma.TransactionClient | typeof prisma;
const insightCache = new Map<string, { at: number; view: InsightsView }>();

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
  flapping: Array<{ serviceId: string; serviceName: string; incidentId: string; episodes: number }>;
}

async function visibleServices(actor: AuthorizationActor, client: Client) {
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
  client: Client
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
  client: Client
): Promise<Array<RateAnomaly & { serviceId: string }>> {
  if (serviceIds.length === 0) return [];
  const recentStart = new Date(now.getTime() - ANOMALY_RECENT_DAYS * DAY_MS);
  const baselineStart = new Date(recentStart.getTime() - ANOMALY_BASELINE_WEEKS * 7 * DAY_MS);
  const rows = await client.$queryRaw<
    Array<{ serviceId: string; week: number; slot: number; count: number }>
  >(Prisma.sql`
    SELECT "serviceId", floor(extract(epoch FROM (${now}::timestamptz - "createdAt")) / 604800)::int AS week,
           (extract(dow FROM "createdAt" AT TIME ZONE 'UTC') * 24 + extract(hour FROM "createdAt" AT TIME ZONE 'UTC'))::int AS slot,
           count(*)::int AS count
    FROM "Incident"
    WHERE "createdAt" >= ${baselineStart} AND "createdAt" <= ${now} AND "serviceId" = ANY(${serviceIds})
    GROUP BY "serviceId", week, slot
  `);
  const counts = new Map<string, { weekly: number[]; slots: Map<number, number[]> }>();
  for (const row of rows) {
    if (row.week < 0 || row.week > ANOMALY_BASELINE_WEEKS) continue;
    const entry = counts.get(row.serviceId) ?? {
      weekly: [0, 0, 0, 0, 0],
      slots: new Map<number, number[]>(),
    };
    const slot = entry.slots.get(row.slot) ?? [0, 0, 0, 0, 0];
    // Week is a database-produced integer checked against the fixed five-element arrays above.
    entry.weekly[row.week] += row.count;
    slot[row.week] += row.count;
    entry.slots.set(row.slot, slot);
    counts.set(row.serviceId, entry);
  }
  const flagged: Array<RateAnomaly & { serviceId: string }> = [];
  for (const [serviceId, entry] of counts) {
    const weekly = detectSeasonalAnomaly(entry.weekly[0], entry.weekly.slice(1));
    const seasonal = [...entry.slots.values()]
      .map(values => detectSeasonalAnomaly(values[0], values.slice(1)))
      .filter((value): value is RateAnomaly => value !== null)
      .sort((a, b) => b.ratio - a.ratio)[0];
    const anomaly = weekly ?? seasonal;
    if (anomaly) flagged.push({ serviceId, ...anomaly });
  }
  return flagged.sort((a, b) => b.ratio - a.ratio || b.recent - a.recent).slice(0, MAX_LIST);
}

export async function getFeedbackCalibration(
  client: Client = prisma
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
  client: Client = prisma
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
  client: Client = prisma
): Promise<InsightsView | null> {
  if (actor.status !== 'ACTIVE' || !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ))
    return null;
  return client === prisma
    ? withDbBudget({ maxDbMs: 10_000 }, tx => loadInsights(actor, now, tx, true))
    : loadInsights(actor, now, client, false);
}

async function loadInsights(
  actor: AuthorizationActor,
  now: Date,
  client: Client,
  allowCache: boolean
): Promise<InsightsView> {
  const services = await visibleServices(actor, client);
  const ids = [...services.keys()];
  // Re-read the actor's visible service set before every cache hit; access changes invalidate its key.
  const key = JSON.stringify([actor.id, actor.role, [...ids].sort(), Math.floor(+now / 300_000)]);
  const hit = allowCache ? insightCache.get(key) : null;
  if (hit && Date.now() - hit.at < 300_000) return hit.view;
  const [weekly, recurring, anomalies, calibration, flapping] = await Promise.all([
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
    flappingAlerts(actor, ids, now, client),
  ]);
  const view: InsightsView = {
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
    flapping: flapping.map(row => ({
      ...row,
      serviceName: services.get(row.serviceId) ?? row.serviceId,
    })),
  };
  if (allowCache) {
    if (insightCache.size >= 100) insightCache.clear();
    insightCache.set(key, { at: Date.now(), view });
  }
  return view;
}

async function flappingAlerts(
  actor: AuthorizationActor,
  serviceIds: string[],
  now: Date,
  client: Client
) {
  if (!serviceIds.length) return [];
  const rows = await client.$queryRaw<
    Array<{ serviceId: string; incidentId: string; episodes: number }>
  >(Prisma.sql`
    WITH episodes AS (
      SELECT "id", "serviceId", "dedupKey", "createdAt", "resolvedAt",
        lag(CASE WHEN "resolvedAt" >= "createdAt" AND "resolvedAt" <= "createdAt" + interval '10 minutes' THEN "resolvedAt" END)
          OVER (PARTITION BY "serviceId", "dedupKey" ORDER BY "createdAt", "id") AS previous_end
      FROM "Incident" WHERE "serviceId" = ANY(${serviceIds}) AND "dedupKey" IS NOT NULL
        AND "createdAt" >= ${new Date(+now - DAY_MS)} AND "createdAt" <= ${now}
    ), segments AS (
      SELECT *, sum(CASE WHEN previous_end <= "createdAt" AND "createdAt" <= previous_end + interval '10 minutes'
        THEN 0 ELSE 1 END) OVER (PARTITION BY "serviceId", "dedupKey" ORDER BY "createdAt", "id") AS segment
      FROM episodes WHERE "resolvedAt" >= "createdAt" AND "resolvedAt" <= "createdAt" + interval '10 minutes'
    ) SELECT "serviceId", (array_agg("id" ORDER BY "createdAt" DESC))[1] AS "incidentId", count(*)::int AS episodes
      FROM segments GROUP BY "serviceId", "dedupKey", segment HAVING count(*) >= 3
      ORDER BY count(*) DESC LIMIT ${MAX_LIST}`);
  const visible = await client.incident.findMany({
    where: { AND: [{ id: { in: rows.map(row => row.incidentId) } }, incidentReadWhere(actor)] },
    select: { id: true },
  });
  const ids = new Set(visible.map(row => row.id));
  return rows.filter(row => ids.has(row.incidentId));
}
