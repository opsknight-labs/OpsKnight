import 'server-only';
import { Prisma } from '@prisma/client';
import { withDbBudget } from './db-budget';
import { closeExpiredGroups } from '../correlation/groups';
import { purgeDeadLetters } from './work-queue';
import type { IntelligenceSettingsView } from '../settings/service';

export const RETENTION_INTERVAL_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
/** Superseded findings are history for audit and debugging only; they are not kept for the full period. */
export const SUPERSEDED_FINDING_RETENTION_DAYS = 7;
/** Dead letters nobody replayed are dropped after this; everything they would produce is rebuildable. */
const DEAD_LETTER_RETENTION_MS = 7 * DAY_MS;

export interface RetentionResult {
  fingerprints: number;
  embeddings: number;
  correlationGroups: number;
  relationships: number;
  findings: number;
  feedback: number;
  evaluationRuns: number;
  patterns: number;
  changeEvents: number;
  digestRuns: number;
  supersededFindings: number;
  deadLetters: number;
  closedGroups: number;
  /** True when any table hit the batch ceiling and more expired rows may remain. */
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

/**
 * Deletes intelligence data older than the UI-configured retention, in bounded batches so a large
 * backlog is worked off over several sweeps instead of holding locks. Everything here is derived
 * data; incident-linked rows also disappear with their incident through cascading foreign keys.
 * Runs even while intelligence is disabled, so retention is honoured regardless of the switch. One
 * replica sweeps at a time; the others skip (and report nothing purged). Links a person made or confirmed
 * are a human record, not derived data, so they are kept until their incidents are deleted.
 */
export async function purgeExpiredIntelligenceData(
  settings: Retention,
  options: { batchSize: number; now?: Date }
): Promise<RetentionResult> {
  const now = options.now ?? new Date();
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const limit = options.batchSize;

  return withDbBudget({ maxDbMs: Math.max(settings.maxDbMs, 5000) }, async tx => {
    const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended('intelligence-retention', 0)) AS locked`;
    if (!locked) {
      return {
        fingerprints: 0,
        embeddings: 0,
        correlationGroups: 0,
        relationships: 0,
        findings: 0,
        feedback: 0,
        evaluationRuns: 0,
        patterns: 0,
        changeEvents: 0,
        digestRuns: 0,
        supersededFindings: 0,
        deadLetters: 0,
        closedGroups: 0,
        more: false,
      };
    }
    const fingerprints = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IncidentFingerprint" WHERE "incidentId" IN (
        SELECT "incidentId" FROM "IncidentFingerprint"
        WHERE "incidentCreatedAt" < ${cutoff(settings.fingerprintRetentionDays)} LIMIT ${limit})`);
    // Vectors are derived from the same title as the fingerprint and share its retention.
    const embeddings = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IncidentEmbedding" WHERE "incidentId" IN (
        SELECT "incidentId" FROM "IncidentEmbedding"
        WHERE "incidentCreatedAt" < ${cutoff(settings.fingerprintRetentionDays)} LIMIT ${limit})`);
    const correlationGroups = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "CorrelationGroup" WHERE "id" IN (
        SELECT "id" FROM "CorrelationGroup"
        WHERE "createdAt" < ${cutoff(settings.correlationRetentionDays)} LIMIT ${limit})`);
    const relationships = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IncidentRelationship" WHERE "id" IN (
        SELECT "id" FROM "IncidentRelationship"
        WHERE "createdAt" < ${cutoff(settings.correlationRetentionDays)}
          AND "origin" <> 'HUMAN'::"IntelligenceOrigin" AND "decision" <> 'ACCEPTED'::"CorrelationDecision"
        LIMIT ${limit})`);
    const findings = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IntelligenceFinding" WHERE "id" IN (
        SELECT "id" FROM "IntelligenceFinding"
        WHERE "createdAt" < ${cutoff(settings.findingRetentionDays)} LIMIT ${limit})`);
    const supersededFindings = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IntelligenceFinding" WHERE "id" IN (
        SELECT "id" FROM "IntelligenceFinding"
        WHERE "status" = 'SUPERSEDED'::"IntelligenceFindingStatus"
          AND "supersededAt" < ${cutoff(Math.min(SUPERSEDED_FINDING_RETENTION_DAYS, settings.findingRetentionDays))}
        LIMIT ${limit})`);
    const deadLetters = await purgeDeadLetters(DEAD_LETTER_RETENTION_MS, limit, tx);
    const closedGroups = await closeExpiredGroups(tx, now, limit);
    const feedback = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IntelligenceFeedback" WHERE "id" IN (
        SELECT "id" FROM "IntelligenceFeedback"
        WHERE "createdAt" < ${cutoff(settings.feedbackRetentionDays)} LIMIT ${limit})`);
    const evaluationRuns = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IntelligenceEvaluationRun" WHERE "id" IN (
        SELECT "id" FROM "IntelligenceEvaluationRun"
        WHERE "createdAt" < ${cutoff(settings.findingRetentionDays)} LIMIT ${limit})`);
    const patterns = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IntelligencePattern" WHERE "id" IN (
        SELECT "id" FROM "IntelligencePattern"
        WHERE "lastSeenAt" < ${cutoff(settings.fingerprintRetentionDays)} LIMIT ${limit})`);

    // Change history is evidence for findings, so it ages out with them.
    const changeEvents = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "ChangeEvent" WHERE "id" IN (
        SELECT "id" FROM "ChangeEvent"
        WHERE "occurredAt" < ${cutoff(settings.findingRetentionDays)} LIMIT ${limit})`);

    // Digest delivery records name recipients by id; they are operational history only.
    const digestRuns = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IntelligenceDigestRun" WHERE "weekKey" IN (
        SELECT "weekKey" FROM "IntelligenceDigestRun"
        WHERE "startedAt" < ${cutoff(settings.findingRetentionDays)} LIMIT ${limit})`);

    const counts = {
      fingerprints,
      embeddings,
      correlationGroups,
      relationships,
      findings,
      feedback,
      evaluationRuns,
      patterns,
      changeEvents,
      digestRuns,
      supersededFindings,
      deadLetters,
      closedGroups,
    };
    return { ...counts, more: Object.values(counts).some(count => count >= limit) };
  });
}
