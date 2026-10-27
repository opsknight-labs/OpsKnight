import 'server-only';
import { Prisma } from '@prisma/client';
import { withDbBudget } from './db-budget';
import type { IntelligenceSettingsView } from '../settings/service';

export const RETENTION_INTERVAL_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

export interface RetentionResult {
  fingerprints: number;
  correlationGroups: number;
  relationships: number;
  findings: number;
  feedback: number;
  evaluationRuns: number;
  patterns: number;
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
 * Runs even while intelligence is disabled, so retention is honoured regardless of the switch.
 */
export async function purgeExpiredIntelligenceData(
  settings: Retention,
  options: { batchSize: number; now?: Date }
): Promise<RetentionResult> {
  const now = options.now ?? new Date();
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const limit = options.batchSize;

  return withDbBudget({ maxDbMs: Math.max(settings.maxDbMs, 5000) }, async tx => {
    const fingerprints = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IncidentFingerprint" WHERE "incidentId" IN (
        SELECT "incidentId" FROM "IncidentFingerprint"
        WHERE "incidentCreatedAt" < ${cutoff(settings.fingerprintRetentionDays)} LIMIT ${limit})`);
    const correlationGroups = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "CorrelationGroup" WHERE "id" IN (
        SELECT "id" FROM "CorrelationGroup"
        WHERE "createdAt" < ${cutoff(settings.correlationRetentionDays)} LIMIT ${limit})`);
    const relationships = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IncidentRelationship" WHERE "id" IN (
        SELECT "id" FROM "IncidentRelationship"
        WHERE "createdAt" < ${cutoff(settings.correlationRetentionDays)} LIMIT ${limit})`);
    const findings = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "IntelligenceFinding" WHERE "id" IN (
        SELECT "id" FROM "IntelligenceFinding"
        WHERE "createdAt" < ${cutoff(settings.findingRetentionDays)} LIMIT ${limit})`);
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

    const counts = { fingerprints, correlationGroups, relationships, findings, feedback, evaluationRuns, patterns };
    return { ...counts, more: Object.values(counts).some(count => count >= limit) };
  });
}
