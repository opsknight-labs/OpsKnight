import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { withDbBudget } from './db-budget';
import { encodeWorkFailure } from './failures';
import { closeExpiredGroups } from '../correlation/groups';
import { purgeDeadLetters } from './work-queue';
import { purgeExpiredKnowledge, purgeExpiredProactiveNotes } from '../memory/sync';
import { purgeOpsInsights } from '../ops-insights/store';
import { purgeExpiredAiResults } from '../ai/result-cache';
import type { IntelligenceSettingsView } from '../settings/service';

export const RETENTION_INTERVAL_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
/** Superseded findings are history for audit and debugging only; they are not kept for the full period. */
export const SUPERSEDED_FINDING_RETENTION_DAYS = 7;
/** Dead letters nobody replayed are dropped after this; everything they would produce is rebuildable. */
const DEAD_LETTER_RETENTION_MS = 7 * DAY_MS;
/** One replica sweeps at a time. The lease outlives any sweep and expires on its own if the sweeper dies. */
export const RETENTION_LEASE_MS = 10 * 60_000;
const LEASE_NAME = 'intelligence-retention-lease';
/** Alert fingerprints are about one row per alert; a huge incident is drained in bigger bites than its parent. */
const ALERT_FINGERPRINT_BATCH_MULTIPLIER = 10;

export interface RetentionResult {
  fingerprints: number;
  alertFingerprints: number;
  embeddings: number;
  correlationGroups: number;
  relationships: number;
  findings: number;
  analysisSnapshots: number;
  feedback: number;
  evaluationRuns: number;
  patterns: number;
  changeEvents: number;
  digestRuns: number;
  supersededFindings: number;
  deadLetters: number;
  closedGroups: number;
  aiReservations: number;
  aiResults: number;
  actionReceipts: number;
  dependencyObservations?: number;
  noiseDecisions?: number;
  knowledgeChunks?: number;
  proactiveNotes?: number;
  metricAnomalies?: number;
  /** Tables whose step failed this sweep (timeout, contention); every other table still progressed. */
  failedTables: string[];
  /** True when any table hit the batch ceiling or failed, so more expired rows may remain. */
  more: boolean;
}

type Retention = Pick<
  IntelligenceSettingsView,
  | 'fingerprintRetentionDays'
  | 'correlationRetentionDays'
  | 'findingRetentionDays'
  | 'feedbackRetentionDays'
  | 'maxDbMs'
>;

/** PostgreSQL undefined_table, as Prisma surfaces it from raw SQL. */
function isMissingRelation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const meta = error.meta as { code?: unknown } | undefined;
  return error.code === 'P2010' && meta?.code === '42P01';
}

const NOTHING: RetentionResult = {
  fingerprints: 0,
  alertFingerprints: 0,
  embeddings: 0,
  correlationGroups: 0,
  relationships: 0,
  findings: 0,
  analysisSnapshots: 0,
  feedback: 0,
  evaluationRuns: 0,
  patterns: 0,
  changeEvents: 0,
  digestRuns: 0,
  supersededFindings: 0,
  deadLetters: 0,
  closedGroups: 0,
  aiReservations: 0,
  aiResults: 0,
  actionReceipts: 0,
  failedTables: [],
  more: false,
};

/**
 * Deletes intelligence data older than the UI-configured retention, in bounded batches so a large
 * backlog is worked off over several sweeps instead of holding locks. Everything here is derived
 * data; incident-linked rows also disappear with their incident through cascading foreign keys.
 * Runs even while intelligence is disabled, so retention is honoured regardless of the switch.
 *
 * Each table is one short transaction under its own budget: a table that keeps timing out (typically the
 * alert fingerprints of a very large incident) never stops the others from making progress, and the alert
 * fingerprints of expired incidents are drained in bounded batches before their parent rows go, so a parent
 * delete can never cascade into tens of thousands of rows at once. One replica sweeps at a time, through a
 * database lease rather than a transaction-long lock. Links a person made or confirmed are a human record,
 * not derived data, so they are kept until their incidents are deleted.
 */
export async function purgeExpiredIntelligenceData(
  settings: Retention,
  options: { batchSize: number; now?: Date }
): Promise<RetentionResult> {
  const now = options.now ?? new Date();
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const limit = options.batchSize;
  const budget = { maxDbMs: Math.max(settings.maxDbMs, 5000) };

  const token = randomUUID();
  const leased = await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "IntelligenceCursor" ("name", "watermarkAt", "lastId", "updatedAt")
    VALUES (${LEASE_NAME}, now() + (${RETENTION_LEASE_MS} * interval '1 millisecond'), ${token}, now())
    ON CONFLICT ("name") DO UPDATE SET
      "watermarkAt" = EXCLUDED."watermarkAt", "lastId" = EXCLUDED."lastId", "updatedAt" = now()
    WHERE "IntelligenceCursor"."watermarkAt" < now()`);
  if (leased !== 1) return { ...NOTHING, failedTables: [] };

  const failedTables: string[] = [];
  const step = async (
    table: string,
    run: (tx: Prisma.TransactionClient) => Promise<number>
  ): Promise<number> => {
    try {
      const deleted = await withDbBudget(budget, run);
      if (deleted > 0)
        addOperationalMetric('opsknight_intelligence_retention_rows_deleted_total', deleted, {
          table,
        });
      return deleted;
    } catch (error) {
      // A table whose migration has not been applied yet (rolling deploy, feature not shipped) has
      // nothing to purge; that is not a failure of this sweep.
      if (isMissingRelation(error)) return 0;
      failedTables.push(table);
      logger.warn('[Intelligence] Retention step failed; other tables continue', {
        table,
        failure: encodeWorkFailure(error),
      });
      return 0;
    }
  };

  try {
    const fingerprintCutoff = cutoff(settings.fingerprintRetentionDays);
    const alertFingerprints = await step('AlertFingerprint', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "AlertFingerprint" WHERE "alertId" IN (
          SELECT a."alertId" FROM "AlertFingerprint" a
          JOIN "IncidentFingerprint" f ON f."incidentId" = a."incidentId"
          WHERE f."incidentCreatedAt" < ${fingerprintCutoff}
          LIMIT ${limit * ALERT_FINGERPRINT_BATCH_MULTIPLIER})`)
    );
    // Parents go only once their alert rows are gone, so the cascade below is always small.
    const fingerprints = await step('IncidentFingerprint', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "IncidentFingerprint" WHERE "incidentId" IN (
          SELECT f."incidentId" FROM "IncidentFingerprint" f
          WHERE f."incidentCreatedAt" < ${fingerprintCutoff}
            AND NOT EXISTS (SELECT 1 FROM "AlertFingerprint" a WHERE a."incidentId" = f."incidentId")
          LIMIT ${limit})`)
    );
    // Vectors are derived from the same title as the fingerprint and share its retention.
    const embeddings = await step('IncidentEmbedding', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "IncidentEmbedding" WHERE "incidentId" IN (
          SELECT "incidentId" FROM "IncidentEmbedding"
          WHERE "incidentCreatedAt" < ${fingerprintCutoff} LIMIT ${limit})`)
    );
    const correlationGroups = await step('CorrelationGroup', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "CorrelationGroup" WHERE "id" IN (
          SELECT "id" FROM "CorrelationGroup"
          WHERE "createdAt" < ${cutoff(settings.correlationRetentionDays)} LIMIT ${limit})`)
    );
    const relationships = await step('IncidentRelationship', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "IncidentRelationship" WHERE "id" IN (
          SELECT "id" FROM "IncidentRelationship"
          WHERE "createdAt" < ${cutoff(settings.correlationRetentionDays)}
            AND "origin" <> 'HUMAN'::"IntelligenceOrigin" AND "decision" <> 'ACCEPTED'::"CorrelationDecision"
          LIMIT ${limit})`)
    );
    const findings = await step('IntelligenceFinding', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "IntelligenceFinding" WHERE "id" IN (
          SELECT "id" FROM "IntelligenceFinding"
          WHERE "createdAt" < ${cutoff(settings.findingRetentionDays)} LIMIT ${limit})`)
    );
    const analysisSnapshots = await step('IntelligenceAnalysisSnapshot', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "IntelligenceAnalysisSnapshot" WHERE ("incidentId", "kind") IN (
          SELECT "incidentId", "kind" FROM "IntelligenceAnalysisSnapshot"
          WHERE "completedAt" < ${cutoff(settings.findingRetentionDays)} LIMIT ${limit})`)
    );
    const supersededFindings = await step('IntelligenceFinding:superseded', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "IntelligenceFinding" WHERE "id" IN (
          SELECT "id" FROM "IntelligenceFinding"
          WHERE "status" = 'SUPERSEDED'::"IntelligenceFindingStatus"
            AND "supersededAt" < ${cutoff(Math.min(SUPERSEDED_FINDING_RETENTION_DAYS, settings.findingRetentionDays))}
          LIMIT ${limit})`)
    );
    const deadLetters = await step('IntelligenceWorkItem', tx =>
      purgeDeadLetters(DEAD_LETTER_RETENTION_MS, limit, tx)
    );
    const closedGroups = await step('CorrelationGroup:closed', tx =>
      closeExpiredGroups(tx, now, limit)
    );
    const feedback = await step('IntelligenceFeedback', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "IntelligenceFeedback" WHERE "id" IN (
          SELECT "id" FROM "IntelligenceFeedback"
          WHERE "createdAt" < ${cutoff(settings.feedbackRetentionDays)} LIMIT ${limit})`)
    );
    const evaluationRuns = await step('IntelligenceEvaluationRun', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "IntelligenceEvaluationRun" WHERE "id" IN (
          SELECT "id" FROM "IntelligenceEvaluationRun"
          WHERE "createdAt" < ${cutoff(settings.findingRetentionDays)} LIMIT ${limit})`)
    );
    const patterns = await step('IntelligencePattern', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "IntelligencePattern" WHERE "id" IN (
          SELECT "id" FROM "IntelligencePattern"
          WHERE "lastSeenAt" < ${fingerprintCutoff} LIMIT ${limit})`)
    );
    // Change history is evidence for findings, so it ages out with them.
    const changeEvents = await step('ChangeEvent', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "ChangeEvent" WHERE "id" IN (
          SELECT "id" FROM "ChangeEvent"
          WHERE "occurredAt" < ${cutoff(settings.findingRetentionDays)} LIMIT ${limit})`)
    );
    // Digest delivery records name recipients by id; they are operational history only.
    const digestRuns = await step('IntelligenceDigestRun', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "IntelligenceDigestRun" WHERE "weekKey" IN (
          SELECT "weekKey" FROM "IntelligenceDigestRun"
          WHERE "startedAt" < ${cutoff(settings.findingRetentionDays)} LIMIT ${limit})`)
    );
    const aiReservations = await step('AiTokenReservation', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "AiTokenReservation" WHERE id IN (
          SELECT id FROM "AiTokenReservation" WHERE "expiresAt" < ${cutoff(1)} LIMIT ${limit})`)
    );
    // Cached AI answers carry their own expiry; expired ones are useless and go first-come.
    const aiResults = await step('AiResultCache', tx => purgeExpiredAiResults(tx, { limit }));
    const actionReceipts = await step('SquireActionReceipt', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "SquireActionReceipt" WHERE id IN (
          SELECT id FROM "SquireActionReceipt" WHERE "createdAt" < ${cutoff(1)} LIMIT ${limit})`)
    );
    const dependencyObservations = await step('DependencyObservationBucket', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "DependencyObservationBucket" WHERE (bucket, "serviceId") IN (
          SELECT bucket, "serviceId" FROM "DependencyObservationBucket"
          WHERE bucket < ${cutoff(30)} ORDER BY bucket, "serviceId" LIMIT ${limit})`)
    );
    const noiseDecisions = await step('NoiseDecision', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "NoiseDecision" WHERE id IN (
          SELECT id FROM "NoiseDecision" WHERE "createdAt" < ${cutoff(settings.correlationRetentionDays)}
          ORDER BY "createdAt", id LIMIT ${limit})`)
    );
    // Squire memory (F4): incident-linked knowledge follows the fingerprint retention (and all derived
    // knowledge goes while the index is off); proactive notes are findings and follow finding retention.
    const knowledgeChunks = await step('KnowledgeChunk', tx =>
      purgeExpiredKnowledge(tx, { cutoff: fingerprintCutoff, limit })
    );
    const proactiveNotes = await step('SquireProactiveNote', tx =>
      purgeExpiredProactiveNotes(tx, { cutoff: cutoff(settings.findingRetentionDays), limit })
    );
    // Metric anomalies are evidence for findings, so they age out with them.
    const metricAnomalies = await step('MetricAnomaly', tx =>
      tx.$executeRaw(Prisma.sql`
        DELETE FROM "MetricAnomaly" WHERE id IN (
          SELECT id FROM "MetricAnomaly" WHERE "at" < ${cutoff(settings.findingRetentionDays)}
          ORDER BY "at", id LIMIT ${limit})`)
    );
    // Operations insights: decided or resolved ones follow finding retention; orphans go with their scope.
    const opsInsights = await step('OpsInsight', tx =>
      purgeOpsInsights(tx, { cutoff: cutoff(settings.findingRetentionDays), limit })
    );
    const counts = {
      fingerprints,
      alertFingerprints,
      embeddings,
      correlationGroups,
      relationships,
      findings,
      analysisSnapshots,
      feedback,
      evaluationRuns,
      patterns,
      changeEvents,
      digestRuns,
      supersededFindings,
      deadLetters,
      closedGroups,
      aiReservations,
      aiResults,
      actionReceipts,
      ...(noiseDecisions > 0 ? { noiseDecisions } : {}),
      ...(dependencyObservations > 0 ? { dependencyObservations } : {}),
      ...(knowledgeChunks > 0 ? { knowledgeChunks } : {}),
      ...(proactiveNotes > 0 ? { proactiveNotes } : {}),
      ...(metricAnomalies > 0 ? { metricAnomalies } : {}),
      ...(opsInsights > 0 ? { opsInsights } : {}),
    };
    const ceilings =
      Object.values(counts).some(count => count >= limit) ||
      alertFingerprints >= limit * ALERT_FINGERPRINT_BATCH_MULTIPLIER;
    return { ...counts, failedTables, more: ceilings || failedTables.length > 0 };
  } finally {
    await prisma
      .$executeRaw(
        Prisma.sql`
        UPDATE "IntelligenceCursor" SET "watermarkAt" = now(), "updatedAt" = now()
        WHERE "name" = ${LEASE_NAME} AND "lastId" = ${token}`
      )
      .catch(() => {
        /* The lease expires on its own. */
      });
  }
}
