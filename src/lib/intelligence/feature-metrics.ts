import 'server-only';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { withDbBudget } from './jobs/db-budget';
import { getAiSettings } from './ai/settings';
import { BACKGROUND_EMBEDDING_ACTOR, backgroundEmbeddingTokenBudget } from './ai/contract';
import { utcDay } from './ai/budget';
import { getSemanticBacklogStatus } from './semantic/embedder';

export const ACTION_METRIC_SAMPLE_CAP = 5000;
export const DIGEST_METRIC_SAMPLE_CAP = 8;
export const SUGGESTION_METRIC_SAMPLE_CAP = 5000;
const ACTION_WINDOW_MS = 86400000;
const DIGEST_WINDOW_MS = 7 * ACTION_WINDOW_MS;
const UNFINISHED_ACTION_STALE_MS = 5 * 60000;
const PROBE_BUDGET = { maxDbMs: 750 };

export type FeatureMetricName =
  | 'opsknight_intelligence_embedding_enabled'
  | 'opsknight_intelligence_embedding_pending'
  | 'opsknight_intelligence_embedding_budget_remaining_tokens'
  | 'opsknight_intelligence_digest_failed_recipients_last_7d'
  | 'opsknight_intelligence_digest_oldest_sending_age_seconds'
  | 'opsknight_intelligence_digest_sample_truncated'
  | 'opsknight_intelligence_squire_actions_confirmed_last_24h'
  | 'opsknight_intelligence_squire_actions_succeeded_last_24h'
  | 'opsknight_intelligence_squire_actions_failed_last_24h'
  | 'opsknight_intelligence_squire_actions_uncertain_last_24h'
  | 'opsknight_intelligence_squire_actions_sample_truncated'
  | 'opsknight_intelligence_suggestions_reviewed_last_24h'
  | 'opsknight_intelligence_suggestion_acceptance_ratio_last_24h'
  | 'opsknight_intelligence_suggestions_sample_truncated'
  | 'opsknight_intelligence_feature_probe_failed';
export interface FeatureMetricSample {
  name: FeatureMetricName;
  value: number;
}

/** Bounded cluster snapshots. No IDs, error text, prompts, recipients or encrypted payloads leave SQL. */
export async function collectFeatureMetrics(now = new Date()): Promise<FeatureMetricSample[]> {
  const samples: FeatureMetricSample[] = [];
  let failed = false;
  try {
    const [settings, index] = await Promise.all([getAiSettings(), getSemanticBacklogStatus(now)]);
    const day = utcDay(now);
    const [usage] = await withDbBudget(PROBE_BUDGET, tx =>
      tx.$queryRaw<Array<{ used: number; held: bigint }>>(Prisma.sql`
      SELECT coalesce((SELECT "backgroundEmbeddingTokens" FROM "AiUsageDay" WHERE day = ${day}), 0)::integer AS used,
        coalesce((SELECT sum(tokens) FROM "AiTokenReservation" WHERE day = ${day}
          AND "actorId" = ${BACKGROUND_EMBEDDING_ACTOR} AND "settledAt" IS NULL AND "expiresAt" > ${now}), 0)::bigint AS held`)
    );
    samples.push(
      { name: 'opsknight_intelligence_embedding_enabled', value: index.model ? 1 : 0 },
      { name: 'opsknight_intelligence_embedding_pending', value: index.pending },
      {
        name: 'opsknight_intelligence_embedding_budget_remaining_tokens',
        value: Math.max(
          0,
          backgroundEmbeddingTokenBudget(settings) - usage.used - Number(usage.held)
        ),
      }
    );
  } catch {
    failed = true;
    logger.debug('[Intelligence] Feature metrics probe unavailable', { probe: 'embedding' });
  }
  try {
    const [digest] = await withDbBudget(PROBE_BUDGET, tx =>
      tx.$queryRaw<Array<{ failed: bigint; oldest: number; sampled: bigint }>>(Prisma.sql`
      WITH candidates AS MATERIALIZED (
        SELECT "weekKey", "startedAt", status, "failedTo" FROM "IntelligenceDigestRun"
        WHERE "startedAt" > ${new Date(+now - DIGEST_WINDOW_MS)} AND "startedAt" <= ${now}
        ORDER BY "startedAt" DESC, "weekKey" DESC LIMIT ${DIGEST_METRIC_SAMPLE_CAP + 1}
      ), sampled AS (
        SELECT * FROM candidates ORDER BY "startedAt" DESC, "weekKey" DESC LIMIT ${DIGEST_METRIC_SAMPLE_CAP}
      ) SELECT coalesce(sum(cardinality("failedTo")), 0)::bigint AS failed,
        coalesce(max(extract(epoch FROM (${now}::timestamptz - "startedAt"))) FILTER (WHERE status = 'SENDING'), 0)::float8 AS oldest,
        (SELECT count(*) FROM candidates)::bigint AS sampled FROM sampled`)
    );
    samples.push(
      {
        name: 'opsknight_intelligence_digest_failed_recipients_last_7d',
        value: Number(digest.failed),
      },
      {
        name: 'opsknight_intelligence_digest_oldest_sending_age_seconds',
        value: Math.max(0, digest.oldest),
      },
      {
        name: 'opsknight_intelligence_digest_sample_truncated',
        value: Number(digest.sampled) > DIGEST_METRIC_SAMPLE_CAP ? 1 : 0,
      }
    );
  } catch {
    failed = true;
    logger.debug('[Intelligence] Feature metrics probe unavailable', { probe: 'digest' });
  }
  try {
    const [actions] = await withDbBudget(PROBE_BUDGET, tx =>
      tx.$queryRaw<
        Array<{
          confirmed: bigint;
          succeeded: bigint;
          failed: bigint;
          uncertain: bigint;
          sampled: bigint;
        }>
      >(Prisma.sql`
      WITH candidates AS MATERIALIZED (
        SELECT id, status, "startedAt", "createdAt" FROM "SquireActionReceipt"
        WHERE "createdAt" > ${new Date(+now - ACTION_WINDOW_MS)} AND "createdAt" <= ${now}
        ORDER BY "createdAt" DESC, id DESC LIMIT ${ACTION_METRIC_SAMPLE_CAP + 1}
      ), sampled AS (
        SELECT * FROM candidates ORDER BY "createdAt" DESC, id DESC LIMIT ${ACTION_METRIC_SAMPLE_CAP}
      ) SELECT count(*)::bigint AS confirmed,
        count(*) FILTER (WHERE status = 'SUCCEEDED')::bigint AS succeeded,
        count(*) FILTER (WHERE status = 'FAILED')::bigint AS failed,
        count(*) FILTER (WHERE status = 'UNKNOWN' OR (status IN ('RESERVED', 'RUNNING')
          AND coalesce("startedAt", "createdAt") <= ${new Date(+now - UNFINISHED_ACTION_STALE_MS)}))::bigint AS uncertain,
        (SELECT count(*) FROM candidates)::bigint AS sampled FROM sampled`)
    );
    samples.push(
      {
        name: 'opsknight_intelligence_squire_actions_confirmed_last_24h',
        value: Number(actions.confirmed),
      },
      {
        name: 'opsknight_intelligence_squire_actions_succeeded_last_24h',
        value: Number(actions.succeeded),
      },
      {
        name: 'opsknight_intelligence_squire_actions_failed_last_24h',
        value: Number(actions.failed),
      },
      {
        name: 'opsknight_intelligence_squire_actions_uncertain_last_24h',
        value: Number(actions.uncertain),
      },
      {
        name: 'opsknight_intelligence_squire_actions_sample_truncated',
        value: Number(actions.sampled) > ACTION_METRIC_SAMPLE_CAP ? 1 : 0,
      }
    );
  } catch {
    failed = true;
    logger.debug('[Intelligence] Feature metrics probe unavailable', { probe: 'actions' });
  }
  try {
    const [reviews] = await withDbBudget(PROBE_BUDGET, tx =>
      tx.$queryRaw<Array<{ accepted: bigint; reviewed: bigint; sampled: bigint }>>(Prisma.sql`
      WITH candidates AS MATERIALIZED (
        SELECT id, "createdAt", "toDecision" FROM "IncidentRelationshipEvent"
        WHERE "actorType" = 'USER' AND "fromDecision" = 'SUGGESTED'
          AND "toDecision" IN ('ACCEPTED', 'REJECTED')
          AND "createdAt" > ${new Date(+now - ACTION_WINDOW_MS)} AND "createdAt" <= ${now}
        ORDER BY "createdAt" DESC, id DESC LIMIT ${SUGGESTION_METRIC_SAMPLE_CAP + 1}
      ), sampled AS (
        SELECT * FROM candidates ORDER BY "createdAt" DESC, id DESC LIMIT ${SUGGESTION_METRIC_SAMPLE_CAP}
      ) SELECT count(*) FILTER (WHERE "toDecision" = 'ACCEPTED')::bigint AS accepted,
        count(*)::bigint AS reviewed, (SELECT count(*) FROM candidates)::bigint AS sampled
        FROM sampled`)
    );
    samples.push(
      {
        name: 'opsknight_intelligence_suggestions_reviewed_last_24h',
        value: Number(reviews.reviewed),
      },
      {
        name: 'opsknight_intelligence_suggestions_sample_truncated',
        value: Number(reviews.sampled) > SUGGESTION_METRIC_SAMPLE_CAP ? 1 : 0,
      }
    );
    // No reviews is unknown acceptance, rather than a fabricated zero-percent result.
    if (Number(reviews.reviewed) > 0)
      samples.push({
        name: 'opsknight_intelligence_suggestion_acceptance_ratio_last_24h',
        value: Number(reviews.accepted) / Number(reviews.reviewed),
      });
  } catch {
    failed = true;
    logger.debug('[Intelligence] Feature metrics probe unavailable', { probe: 'suggestions' });
  }
  samples.push({ name: 'opsknight_intelligence_feature_probe_failed', value: failed ? 1 : 0 });
  return samples;
}
