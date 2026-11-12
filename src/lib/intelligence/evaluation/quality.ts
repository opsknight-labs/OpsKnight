import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { INTELLIGENCE_ENGINE_VERSION, type PolicyDefinition } from '../contract';
import { loadActiveEdges } from '../dependencies/service';
import type { DependencyEdge } from '../dependencies/graph';
import { withDbBudget } from '../jobs/db-budget';
import type { EffectivePolicy, IntelligenceActor } from '../settings/service';
import {
  assessAutoQuality,
  assessRuleCoverage,
  type RuleQuality,
  measureQuality,
  type QualityMetrics,
} from './quality-metrics';

type Client = Prisma.TransactionClient | typeof prisma;
export const AUTO_CERTIFICATION_MAX_AGE_MS = 7 * 86_400_000;
export const QUALITY_MAX_REVIEWED_PAIRS = 2000;

export async function qualityPolicyHash(
  definition: PolicyDefinition,
  client: Client = prisma
): Promise<string> {
  const edges = definition.correlation.rules.some(rule => rule.enabled && rule.kind === 'TOPOLOGY')
    ? await loadActiveEdges(client)
    : [];
  return hashPolicy(definition, edges);
}

function hashPolicy(definition: PolicyDefinition, graph: readonly DependencyEdge[]) {
  const edges = definition.correlation.rules.some(rule => rule.enabled && rule.kind === 'TOPOLOGY')
    ? graph
    : [];
  const canonical = {
    engineVersion: INTELLIGENCE_ENGINE_VERSION,
    definition: {
      ...definition,
      correlation: {
        ...definition.correlation,
        rules: [...definition.correlation.rules]
          .map(rule => ({ ...rule, keys: [...rule.keys].sort() }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      },
    },
    edges: edges.map(edge => `${edge.upstreamServiceId}:${edge.downstreamServiceId}`).sort(),
  };
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, stable(child)])
          )
        : value;
  return createHash('sha256')
    .update(JSON.stringify(stable(canonical)))
    .digest('hex');
}

const metricSchema = z.object({
  sampleCount: z.number().int().nonnegative(),
  predictions: z.number().int().nonnegative(),
  truePositives: z.number().int().nonnegative(),
  falsePositives: z.number().int().nonnegative(),
  falseNegatives: z.number().int().nonnegative(),
  trueNegatives: z.number().int().nonnegative(),
  negativeLabels: z.number().int().nonnegative(),
  criticalLabels: z.number().int().nonnegative(),
  criticalFalseMerges: z.number().int().nonnegative(),
  precision: z.number().min(0).max(1),
  precisionLowerBound: z.number().min(0).max(1),
  recall: z.number().min(0).max(1),
  falseMergeRate: z.number().min(0).max(1),
  criticalFalseMergeRate: z.number().min(0).max(1),
  calibration: z
    .array(
      z.object({
        from: z.number(),
        to: z.number(),
        count: z.number(),
        meanScore: z.number(),
        observedPositiveRate: z.number(),
      })
    )
    .max(10),
});

const storedSchema = metricSchema.extend({
  reviewedOnly: z.literal(true),
  serviceId: z.string(),
  policyHash: z.string(),
  engineVersion: z.string(),
  perRule: z.array(
    z.object({ ruleId: z.string(), metrics: metricSchema, crossService: metricSchema })
  ),
});
function assess(definition: PolicyDefinition, metrics: QualityMetrics, perRule: RuleQuality[]) {
  const aggregate = assessAutoQuality(metrics);
  return aggregate.allowed ? assessRuleCoverage(definition.correlation.rules, perRule) : aggregate;
}

export interface AutoGate {
  allowed: boolean;
  reason: string;
  runId: string | null;
  metrics: QualityMetrics | null;
}

/** Only a recent, completed certification of this exact definition/engine/topology opens AUTO. */
export async function getAutoGate(
  serviceId: string,
  definition: PolicyDefinition,
  client: Client = prisma,
  now = new Date()
): Promise<AutoGate> {
  return (await getAutoGates([{ serviceId, definition }], client, now)).get(serviceId)!;
}

/** Fixed-query batch for the per-service settings page; publication and execution re-check this gate. */
export async function getAutoGates(
  requests: readonly { serviceId: string; definition: PolicyDefinition }[],
  client: Client = prisma,
  now = new Date()
): Promise<Map<string, AutoGate>> {
  if (!requests.length) return new Map();
  const ids = requests.map(row => row.serviceId);
  const [runs, edges] = await Promise.all([
    client.$queryRaw<
      Array<{ id: string; completedAt: Date; windowEnd: Date; metrics: Prisma.JsonValue }>
    >(Prisma.sql`
      SELECT DISTINCT ON ("metrics"->>'serviceId') "id", "completedAt", "windowEnd", "metrics"
      FROM "IntelligenceEvaluationRun" WHERE "kind" = 'CERTIFICATION' AND "status" = 'COMPLETED'
        AND "metrics"->>'serviceId' = ANY(${ids})
      ORDER BY "metrics"->>'serviceId', "completedAt" DESC`),
    requests.some(row =>
      row.definition.correlation.rules.some(rule => rule.enabled && rule.kind === 'TOPOLOGY')
    )
      ? loadActiveEdges(client)
      : Promise.resolve([]),
  ]);
  const byService = new Map(
    runs.flatMap(run => {
      const parsed = storedSchema.safeParse(run.metrics);
      return parsed.success
        ? [[parsed.data.serviceId, { run, metrics: parsed.data }] as const]
        : [];
    })
  );
  const since = new Date(
    Math.max(+now - AUTO_CERTIFICATION_MAX_AGE_MS, Math.min(...runs.map(run => +run.windowEnd)))
  );
  const reviews = runs.length
    ? await client.$queryRaw<Array<{ serviceId: string; latest: Date }>>(Prisma.sql`
    SELECT affected.service_id AS "serviceId", max(e."createdAt") AS latest
    FROM "IncidentRelationshipEvent" e JOIN "IncidentRelationship" r ON r."id" = e."relationshipId"
    JOIN "Incident" s ON s."id" = r."sourceIncidentId" JOIN "Incident" t ON t."id" = r."targetIncidentId"
    CROSS JOIN LATERAL (VALUES (s."serviceId"), (t."serviceId")) affected(service_id)
    WHERE e."actorType" = 'USER' AND e."createdAt" > ${since}
      AND e."toDecision" IN ('ACCEPTED', 'REJECTED', 'REVERTED') AND r."type" IN ('RELATED', 'DUPLICATE_OF')
      AND affected.service_id = ANY(${ids}) GROUP BY affected.service_id`)
    : [];
  const latest = new Map(reviews.map(row => [row.serviceId, row.latest]));
  return new Map<string, AutoGate>(
    requests.map(({ serviceId, definition }): [string, AutoGate] => {
      const entry = byService.get(serviceId);
      if (!entry)
        return [
          serviceId,
          {
            allowed: false,
            reason: 'No completed quality certification for this service.',
            runId: null,
            metrics: null,
          },
        ];
      const { run, metrics } = entry;
      if (
        +now - +run.completedAt > AUTO_CERTIFICATION_MAX_AGE_MS ||
        +run.completedAt > +now + 60_000 ||
        metrics.policyHash !== hashPolicy(definition, edges) ||
        metrics.engineVersion !== INTELLIGENCE_ENGINE_VERSION
      ) {
        return [
          serviceId,
          {
            allowed: false,
            reason: 'Certification is stale or the policy, engine or dependency graph changed.',
            runId: run.id,
            metrics,
          },
        ];
      }
      if (+(latest.get(serviceId) ?? 0) > +run.windowEnd)
        return [
          serviceId,
          {
            allowed: false,
            reason: 'New human decisions require a fresh quality certification.',
            runId: run.id,
            metrics,
          },
        ];
      return [
        serviceId,
        { ...assess(definition, metrics, metrics.perRule), runId: run.id, metrics },
      ];
    })
  );
}

export async function getLatestQualityMeasurement(serviceId: string, client: Client = prisma) {
  const row = await client.intelligenceEvaluationRun.findFirst({
    where: {
      kind: { in: ['SHADOW', 'CERTIFICATION'] },
      status: 'COMPLETED',
      metrics: { path: ['serviceId'], equals: serviceId },
    },
    orderBy: { completedAt: 'desc' },
    select: { id: true, kind: true, completedAt: true, metrics: true },
  });
  const parsed = storedSchema.safeParse(row?.metrics);
  return row && parsed.success
    ? { id: row.id, kind: row.kind, completedAt: row.completedAt, metrics: parsed.data }
    : null;
}

/** Caller authorizes INTELLIGENCE_MANAGE. Labels must come from explicit USER decision events. */
export async function evaluateServiceQuality(
  serviceId: string,
  policy: EffectivePolicy,
  actor: IntelligenceActor,
  certify: boolean,
  now = new Date()
) {
  const since = new Date(+now - 30 * 86_400_000);
  const policyHash = await qualityPolicyHash(policy.definition);
  const run = await prisma.intelligenceEvaluationRun.create({
    data: {
      kind: certify ? 'CERTIFICATION' : 'SHADOW',
      status: 'RUNNING',
      policyId: policy.policyId,
      policyVersion: policy.version,
      windowStart: since,
      windowEnd: now,
      createdById: actor.actorId,
      startedAt: now,
    },
  });
  try {
    const metrics = await withDbBudget({ maxDbMs: 10_000 }, async tx => {
      const pairs = await tx.$queryRaw<
        Array<{
          sourceId: string;
          targetId: string;
          linked: boolean;
          critical: boolean;
          reviewedAt: Date;
          crossService: boolean;
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (LEAST(r."sourceIncidentId", r."targetIncidentId"), GREATEST(r."sourceIncidentId", r."targetIncidentId"))
          r."sourceIncidentId" AS "sourceId", r."targetIncidentId" AS "targetId", e."toDecision" = 'ACCEPTED' AS linked,
          (s."urgency" = 'HIGH' OR t."urgency" = 'HIGH') AS critical, (s."serviceId" <> t."serviceId") AS "crossService", e."createdAt" AS "reviewedAt"
        FROM "IncidentRelationshipEvent" e JOIN "IncidentRelationship" r ON r."id" = e."relationshipId"
        JOIN "Incident" s ON s."id" = r."sourceIncidentId" JOIN "Incident" t ON t."id" = r."targetIncidentId"
        WHERE e."actorType" = 'USER' AND e."toDecision" IN ('ACCEPTED', 'REJECTED', 'REVERTED')
          AND e."createdAt" >= ${since} AND e."createdAt" <= ${now}
          AND (s."serviceId" = ${serviceId} OR t."serviceId" = ${serviceId})
          AND r."type" IN ('RELATED', 'DUPLICATE_OF')
        ORDER BY LEAST(r."sourceIncidentId", r."targetIncidentId"), GREATEST(r."sourceIncidentId", r."targetIncidentId"), e."createdAt" DESC
        LIMIT ${QUALITY_MAX_REVIEWED_PAIRS}`);
      const ids = [...new Set(pairs.flatMap(pair => [pair.sourceId, pair.targetId]))];
      const members = ids.length
        ? await tx.$queryRaw<
            Array<{
              incidentId: string;
              groupId: string;
              ruleId: string;
              score: number;
              createdAt: Date;
            }>
          >(Prisma.sql`
        SELECT m."incidentId", m."groupId", g."ruleId", m."score", m."createdAt"
        FROM "CorrelationMember" m JOIN "CorrelationGroup" g ON g."id" = m."groupId"
        JOIN "IntelligencePolicyVersion" v ON v."policyId" = g."policyId" AND v."version" = g."policyVersion"
        WHERE m."incidentId" = ANY(${ids}) AND m."engineVersion" = ${INTELLIGENCE_ENGINE_VERSION}
          AND v."definition" = ${JSON.stringify(policy.definition)}::jsonb`)
        : [];
      const byIncident = new Map<string, typeof members>();
      for (const member of members) {
        const list = byIncident.get(member.incidentId) ?? [];
        list.push(member);
        byIncident.set(member.incidentId, list);
      }
      const judged = pairs.map(pair => {
        const left = (byIncident.get(pair.sourceId) ?? []).filter(
          member => +member.createdAt <= +pair.reviewedAt
        );
        const right = (byIncident.get(pair.targetId) ?? []).filter(
          member => +member.createdAt <= +pair.reviewedAt
        );
        const matches = left.flatMap(a =>
          right
            .filter(b => a.groupId === b.groupId)
            .map(b => ({ ruleId: a.ruleId, score: Math.min(a.score, b.score) }))
        );
        return {
          matches,
          crossService: pair.crossService,
          linked: pair.linked,
          critical: pair.critical,
          predicted: matches.length > 0,
          score: matches.length ? Math.max(...matches.map(match => match.score)) : 0,
        };
      });
      const result = measureQuality(judged);
      const perRule = policy.definition.correlation.rules
        .filter(rule => rule.enabled)
        .map(rule => {
          const rows = judged.map(row => {
            const matches = row.matches.filter(match => match.ruleId === rule.id);
            return {
              ...row,
              predicted: matches.length > 0,
              score: Math.max(0, ...matches.map(match => match.score)),
            };
          });
          return {
            ruleId: rule.id,
            metrics: measureQuality(rows),
            crossService: measureQuality(rows.filter(row => row.crossService)),
          };
        });
      await tx.intelligenceEvaluationRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          metrics: {
            ...result,
            perRule,
            calibration: result.calibration.map(bin => ({ ...bin })),
            serviceId,
            policyHash,
            engineVersion: INTELLIGENCE_ENGINE_VERSION,
            reviewedOnly: true,
          },
        },
      });
      await logAudit(
        {
          action: certify ? 'intelligence.quality.certified' : 'intelligence.quality.measured',
          entityType: 'SYSTEM_CONFIG',
          entityId: `intelligence-quality:${serviceId}`,
          actorId: actor.actorId,
          source: actor.source,
          details: {
            runId: run.id,
            serviceId,
            policyHash,
            sampleCount: result.sampleCount,
            allowed: certify && assess(policy.definition, result, perRule).allowed,
          },
        },
        tx
      );
      return { ...result, perRule };
    });
    return { runId: run.id, metrics, ...assess(policy.definition, metrics, metrics.perRule) };
  } catch (error) {
    await prisma.intelligenceEvaluationRun
      .update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date(), error: 'Quality evaluation failed.' },
      })
      .catch(() => undefined);
    throw error;
  }
}
