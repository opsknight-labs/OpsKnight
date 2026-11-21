import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { DEFAULT_RUNBOOK_WEIGHTS, runbookWeightsSchema, type RunbookWeights } from '../contract';
import { withDbBudget } from '../jobs/db-budget';
import { stableAnalysisHash } from '../jobs/input-hash';
import { enqueueWorkItems, WORK_KINDS, type ClaimedWorkItem } from '../jobs/work-queue';
import { scoreRunbook, type RunbookScoreFeatures } from '../recommendations/wilson';
import { STORED_PROPOSAL_KINDS } from './proposal-store';
import { refreshResponseWeightProposal } from './response-weights';
import { refreshScoringWeightProposal } from './weights-service';
import {
  parseOrThrow,
  publishPolicyVersion,
  resolveEffectivePolicy,
  type IntelligenceActor,
  getIntelligenceSettings,
} from '../settings/service';
import {
  clamp,
  coordinateDescent,
  hasMinimumSupport,
  holdOutSplit,
  IMPLICIT_LABEL_WEIGHT,
  logLoss,
  sigmoid,
} from './bounded-fit';

/**
 * Offline fitting of runbook-ranking weights, the runbook counterpart of the cause-weight fit. Labels come
 * from two places: a responder's accept/reject verdict on a runbook recommendation, and the observed outcome
 * when the recommended runbook was then run on that incident (it fixed the incident when the run succeeded and
 * the incident resolved within IntelligenceSettings.runbookFixWindowMinutes; it did not when the run failed, timed out, or succeeded
 * without the incident resolving in that window). An observed outcome outranks a verdict for the same
 * recommendation. Each label carries the evidence the ranker saw when it made the recommendation, so the fit
 * learns how much to trust the service-wide record, the same-problem record, MTTR improvement and an untried
 * binding. Suggest-only: nothing applies until a person publishes the proposal as a policy version.
 *
 * The fit runs in the intelligence lane as a daily FIT_RUNBOOK_WEIGHTS work item (scheduleRunbookWeightFit
 * enqueues it, runRunbookWeightFit handles it): skipped when the labelled examples are unchanged, and fenced
 * on the item's generation. Its result is stored, so the review page only reads one row.
 */

export interface RunbookExample extends RunbookScoreFeatures {
  helpful: boolean;
  /** IMPLICIT: the runbook is named in the incident's postmortem; weighted below stated labels. */
  source: 'FEEDBACK' | 'OUTCOME' | 'IMPLICIT';
  weight?: number;
}

export interface RunbookWeightsProposal {
  weights: RunbookWeights;
  heldOutLoss: number;
  baselineLoss: number;
  support: number;
  /** Labels by origin, so a reviewer can see what the proposal rests on. */
  fromFeedback: number;
  fromOutcomes: number;
  fromImplicit: number;
}

export const RUNBOOK_FIT_LIMITS = {
  minExamples: 40,
  minPerVerdict: 8,
  lookbackDays: 90,
  maxRows: 2000,
  statementTimeoutMs: 5000,
} as const;

function predict(example: RunbookExample, weights: RunbookWeights): number {
  return sigmoid(6 * (scoreRunbook(example, weights) - 0.35));
}

const loss = (rows: readonly RunbookExample[], weights: RunbookWeights) =>
  logLoss(rows, weights, predict);

const validCounts = (succeeded: number, eligible: number) =>
  Number.isFinite(succeeded) &&
  Number.isFinite(eligible) &&
  succeeded >= 0 &&
  eligible >= 0 &&
  succeeded <= eligible;

/** Coordinate descent over the bounded weights; offered only when it beats the shipped ranking held out. */
export function fitRunbookWeights(
  examples: readonly RunbookExample[]
): RunbookWeightsProposal | null {
  const rows = examples.filter(
    row =>
      validCounts(row.succeeded, row.eligible) &&
      (!row.sameProblem || validCounts(row.sameProblem.succeeded, row.sameProblem.eligible))
  );
  if (
    !hasMinimumSupport(rows, {
      rows: RUNBOOK_FIT_LIMITS.minExamples,
      perVerdict: RUNBOOK_FIT_LIMITS.minPerVerdict,
    })
  )
    return null;
  const { train, held } = holdOutSplit(rows);
  if (new Set(held.map(row => row.helpful)).size < 2) return null;
  const weights = coordinateDescent<RunbookWeights>(
    { ...DEFAULT_RUNBOOK_WEIGHTS },
    [
      (w, d) => ({ ...w, overall: clamp(w.overall + d, 0.5, 1) }),
      (w, d) => ({ ...w, sameProblem: clamp(w.sameProblem + d, 0.5, 1) }),
      (w, d) => ({ ...w, mttrBonus: clamp(w.mttrBonus + d, 0, 0.3) }),
      (w, d) => ({ ...w, boundPrior: clamp(w.boundPrior + d, 0, 0.2) }),
    ],
    candidate => loss(train, candidate)
  );
  const heldOutLoss = loss(held, weights);
  const baselineLoss = loss(held, DEFAULT_RUNBOOK_WEIGHTS);
  if (!(heldOutLoss < baselineLoss - 0.01)) return null;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    weights: runbookWeightsSchema.parse({
      overall: round(weights.overall),
      sameProblem: round(weights.sameProblem),
      mttrBonus: round(weights.mttrBonus),
      boundPrior: round(weights.boundPrior),
    }),
    heldOutLoss,
    baselineLoss,
    support: rows.length,
    fromFeedback: rows.filter(row => row.source === 'FEEDBACK').length,
    fromOutcomes: rows.filter(row => row.source === 'OUTCOME').length,
    fromImplicit: rows.filter(row => row.source === 'IMPLICIT').length,
  };
}

const evidenceSchema = z.object({
  succeeded: z.number(),
  eligible: z.number(),
  bound: z.boolean(),
  mttrImprovement: z.number().optional(),
  sameProblem: z.object({ succeeded: z.number(), eligible: z.number() }).optional(),
});

type LabelRow = {
  findingId: string;
  incidentId: string;
  runbookId: string;
  evidence: Prisma.JsonValue;
  helpful: boolean;
};

/**
 * Loads labelled runbook recommendations. Both reads start from small, index-backed sets (recent feedback;
 * recently finished executions via (status, updatedAt)) and are capped; the whole read runs under a statement
 * timeout so a review page can never hold the database.
 */
export async function loadRunbookExamples(
  client: typeof prisma = prisma
): Promise<RunbookExample[]> {
  const { lookbackDays, maxRows, statementTimeoutMs } = RUNBOOK_FIT_LIMITS;
  const resolvedWithinMinutes = (await getIntelligenceSettings(client)).runbookFixWindowMinutes;
  const [feedback, outcomes, implicit] = await client.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
    const verdicts = await tx.$queryRaw<LabelRow[]>`
      SELECT DISTINCT ON (f."id") f."id" AS "findingId", f."incidentId", f."subjectRef" AS "runbookId",
             f."evidence", fb."verdict" IN ('HELPFUL', 'CORRECT') AS helpful
      FROM "IntelligenceFeedback" fb JOIN "IntelligenceFinding" f ON f."id" = fb."subjectId"
      WHERE fb."subjectType" = 'FINDING' AND f."kind" = 'RUNBOOK_RECOMMENDATION'
        AND f."subjectRef" IS NOT NULL
        AND fb."verdict" IN ('HELPFUL', 'NOT_HELPFUL', 'CORRECT', 'INCORRECT')
        AND fb."createdAt" >= now() - make_interval(days => ${lookbackDays}::int)
      ORDER BY f."id", fb."createdAt" DESC
      LIMIT ${maxRows}`;
    // The first decided run of a recommended runbook on an incident, recommended before it ran. A successful
    // run whose window has not elapsed yet, or that ran on an incident already resolved, is undecided.
    const observed = await tx.$queryRaw<LabelRow[]>`
      WITH recent AS (
        SELECT e."incidentId", e."runbookId", e."status", e."startedAt", e."completedAt", e."createdAt"
        FROM "RunbookExecution" e
        WHERE e."status" IN ('SUCCEEDED', 'FAILED', 'TIMED_OUT')
          AND e."updatedAt" >= now() - make_interval(days => ${lookbackDays}::int)
          AND e."incidentId" IS NOT NULL AND e."completedAt" IS NOT NULL
        ORDER BY e."updatedAt" DESC
        LIMIT ${maxRows}
      ), decided AS (
        SELECT DISTINCT ON (r."incidentId", r."runbookId") r."incidentId", r."runbookId", r."createdAt",
               (r."status" = 'SUCCEEDED' AND i."status" = 'RESOLVED'
                 AND i."resolvedAt" <= r."completedAt" + make_interval(mins => ${resolvedWithinMinutes}::int)) AS helpful
        FROM recent r JOIN "Incident" i ON i."id" = r."incidentId"
        WHERE (i."resolvedAt" IS NULL OR r."startedAt" IS NULL OR i."resolvedAt" >= r."startedAt")
          AND (r."status" <> 'SUCCEEDED' OR i."status" = 'RESOLVED'
               OR r."completedAt" + make_interval(mins => ${resolvedWithinMinutes}::int) < now())
        ORDER BY r."incidentId", r."runbookId", r."createdAt" ASC
      )
      SELECT f."id" AS "findingId", d."incidentId", d."runbookId", f."evidence", d.helpful
      FROM decided d
      JOIN LATERAL (
        SELECT x."id", x."evidence" FROM "IntelligenceFinding" x
        WHERE x."incidentId" = d."incidentId" AND x."kind" = 'RUNBOOK_RECOMMENDATION'
          AND x."subjectRef" = d."runbookId" AND x."createdAt" <= d."createdAt"
        ORDER BY x."createdAt" DESC LIMIT 1
      ) f ON true`;
    // Implicit: a recommended runbook the postmortem names in its resolution or root cause.
    const named = await tx.$queryRaw<LabelRow[]>`
      SELECT DISTINCT ON (f."id") f."id" AS "findingId", f."incidentId", f."subjectRef" AS "runbookId",
             f."evidence", true AS helpful
      FROM "Postmortem" p
      JOIN "IntelligenceFinding" f ON f."incidentId" = p."incidentId" AND f."kind" = 'RUNBOOK_RECOMMENDATION'
      JOIN "Runbook" rb ON rb."id" = f."subjectRef"
      WHERE p."updatedAt" >= now() - make_interval(days => ${lookbackDays}::int)
        AND length(rb."name") >= 6
        AND strpos(lower(coalesce(p."resolution", '') || ' ' || coalesce(p."rootCause", '')), lower(rb."name")) > 0
      ORDER BY f."id", f."createdAt" DESC
      LIMIT ${maxRows}`;
    return [verdicts, observed, named] as const;
  });
  return mergeRunbookLabels(feedback, outcomes, implicit);
}

/**
 * One label per (incident, runbook). Precedence: observed outcome over a stated verdict over an implicit
 * postmortem mention.
 */
export function mergeRunbookLabels(
  feedback: readonly LabelRow[],
  outcomes: readonly LabelRow[],
  implicit: readonly LabelRow[] = []
): RunbookExample[] {
  const byKey = new Map<string, RunbookExample & { findingId: string }>();
  const add = (row: LabelRow, source: RunbookExample['source']) => {
    const parsed = evidenceSchema.safeParse(row.evidence);
    if (!parsed.success) return;
    byKey.set(`${row.incidentId}\u0000${row.runbookId}`, {
      findingId: row.findingId,
      succeeded: parsed.data.succeeded,
      eligible: parsed.data.eligible,
      bound: parsed.data.bound,
      ...(parsed.data.mttrImprovement !== undefined
        ? { mttrImprovement: parsed.data.mttrImprovement }
        : {}),
      ...(parsed.data.sameProblem ? { sameProblem: parsed.data.sameProblem } : {}),
      helpful: row.helpful,
      source,
      ...(source === 'IMPLICIT' ? { weight: IMPLICIT_LABEL_WEIGHT } : {}),
    });
  };
  for (const row of implicit) add(row, 'IMPLICIT');
  for (const row of feedback) add(row, 'FEEDBACK');
  for (const row of outcomes) add(row, 'OUTCOME');
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, example]) => {
      const { findingId: _findingId, ...rest } = example;
      return rest;
    });
}

export async function suggestRunbookWeights(client: typeof prisma = prisma) {
  return proposalFor(await loadRunbookExamples(client));
}

function proposalFor(examples: RunbookExample[]) {
  const proposal = fitRunbookWeights(examples);
  if (!proposal) return null;
  return {
    ...proposal,
    id: createHash('sha256')
      .update(
        JSON.stringify([
          examples.map(row => [row.succeeded, row.eligible, row.bound, row.helpful, row.source]),
          proposal.weights,
        ])
      )
      .digest('hex')
      .slice(0, 32),
  };
}

export type StoredRunbookWeightsProposal = NonNullable<
  Awaited<ReturnType<typeof suggestRunbookWeights>>
>;

/** Where the lane keeps the latest fit: one IntelligencePattern row, read by primary-key-like unique. */
const PROPOSAL_ROW = {
  scopeKey: 'global',
  kind: 'RUNBOOK_WEIGHTS_PROPOSAL',
  key: 'latest',
} as const;
const proposalWhere = { scopeKey_kind_key: PROPOSAL_ROW };
export const RUNBOOK_FIT_SCHEDULE = {
  checkIntervalMs: 15 * 60_000,
  refitAfterMs: 24 * 60 * 60_000,
} as const;

async function storeRunbookWeightProposal(
  proposal: StoredRunbookWeightsProposal | null,
  client: typeof prisma
) {
  const stats = { proposal } as unknown as Prisma.InputJsonValue;
  await client.intelligencePattern.upsert({
    where: proposalWhere,
    create: { ...PROPOSAL_ROW, stats, support: proposal?.support ?? 0 },
    update: { stats, support: proposal?.support ?? 0, lastSeenAt: new Date() },
  });
}

/** Stores a lane fit unless a newer generation already stored one. Returns whether it was written. */
async function storeFencedRunbookWeightProposal(
  proposal: StoredRunbookWeightsProposal | null,
  fence: { inputHash: string; generation: number },
  client: typeof prisma
): Promise<boolean> {
  const stats = JSON.stringify({ proposal, ...fence });
  const written = await client.$executeRaw`
    INSERT INTO "IntelligencePattern" ("id", "scopeKey", "kind", "key", "stats", "support", "lastSeenAt", "updatedAt")
    VALUES (${randomUUID()}, ${PROPOSAL_ROW.scopeKey}, ${PROPOSAL_ROW.kind}, ${PROPOSAL_ROW.key},
      ${stats}::jsonb, ${proposal?.support ?? 0}, now(), now())
    ON CONFLICT ("scopeKey", "kind", "key") DO UPDATE SET
      "stats" = EXCLUDED."stats", "support" = EXCLUDED."support", "lastSeenAt" = now(), "updatedAt" = now()
    WHERE COALESCE(("IntelligencePattern"."stats"->>'generation')::bigint, 0) <= ${fence.generation}`;
  return written > 0;
}

export type RunbookWeightFitOutcome = 'unchanged' | 'fitted' | 'stale';

/**
 * The FIT_RUNBOOK_WEIGHTS handler. The two capped reads always run; the fit and the write are skipped when
 * the labelled examples hash to what the stored fit used (only its timestamp moves, so the schedule waits
 * another day). An older generation never overwrites a newer fit.
 */
export async function runRunbookWeightFit(
  item: Pick<ClaimedWorkItem, 'generation' | 'force'>,
  client: typeof prisma = prisma,
  budget: { maxDbMs: number } = { maxDbMs: 30_000 }
): Promise<RunbookWeightFitOutcome> {
  // The same daily job refits the similarity and cause proposals the settings page shows, each under the
  // lane's statement budget.
  await withDbBudget(budget, tx => refreshScoringWeightProposal(tx), client);
  await withDbBudget(budget, tx => refreshResponseWeightProposal(tx), client);
  const examples = await loadRunbookExamples(client);
  const inputHash = stableAnalysisHash(['runbook-weights:v1', RUNBOOK_FIT_LIMITS, examples]);
  const stored = await client.intelligencePattern.findUnique({
    where: proposalWhere,
    select: { stats: true },
  });
  if (!item.force && (stored?.stats as { inputHash?: unknown } | null)?.inputHash === inputHash) {
    await client.intelligencePattern.update({
      where: proposalWhere,
      data: { lastSeenAt: new Date() },
    });
    return 'unchanged';
  }
  const written = await storeFencedRunbookWeightProposal(
    proposalFor(examples),
    { inputHash, generation: item.generation },
    client
  );
  return written ? 'fitted' : 'stale';
}

/** Fits now and stores the result (null when there is no supported improvement). */
export async function refreshRunbookWeightProposal(client: typeof prisma = prisma) {
  const proposal = await suggestRunbookWeights(client);
  await storeRunbookWeightProposal(proposal, client);
  return proposal;
}

/** The latest stored proposal, for the review page: one indexed read, no fit. */
export async function readRunbookWeightProposal(
  client: typeof prisma = prisma
): Promise<{ proposal: StoredRunbookWeightsProposal | null; computedAt: Date } | null> {
  const row = await client.intelligencePattern.findUnique({
    where: proposalWhere,
    select: { stats: true, lastSeenAt: true },
  });
  if (!row) return null;
  const stored = (row.stats as { proposal?: StoredRunbookWeightsProposal | null } | null)?.proposal;
  const valid =
    stored &&
    typeof stored.id === 'string' &&
    runbookWeightsSchema.safeParse(stored.weights).success &&
    typeof stored.heldOutLoss === 'number' &&
    typeof stored.baselineLoss === 'number';
  return { proposal: valid ? stored : null, computedAt: row.lastSeenAt };
}

const fitSchedule = { checkedAt: 0 };

/** Tests only: forget when the fit was last checked. */
export function resetRunbookWeightFitSchedule(): void {
  fitSchedule.checkedAt = 0;
}

/**
 * Called once per lane cycle: nothing between checks, then one indexed read, and at most once a day one
 * coalesced FIT_RUNBOOK_WEIGHTS work item (the fit itself runs in its handler). Returns whether it enqueued.
 */
export async function scheduleRunbookWeightFit(
  now: number,
  client: typeof prisma = prisma
): Promise<boolean> {
  if (now - fitSchedule.checkedAt < RUNBOOK_FIT_SCHEDULE.checkIntervalMs) return false;
  fitSchedule.checkedAt = now;
  const kinds = [PROPOSAL_ROW.kind, ...STORED_PROPOSAL_KINDS];
  const rows = await client.intelligencePattern.findMany({
    where: { scopeKey: PROPOSAL_ROW.scopeKey, key: PROPOSAL_ROW.key, kind: { in: kinds } },
    select: { lastSeenAt: true },
  });
  if (
    rows.length === kinds.length &&
    rows.every(row => now - row.lastSeenAt.getTime() < RUNBOOK_FIT_SCHEDULE.refitAfterMs)
  )
    return false;
  await enqueueWorkItems([{ kind: WORK_KINDS.FIT_RUNBOOK_WEIGHTS, subjectKey: 'global' }], client);
  return true;
}

/** Recompute before publishing: the browser cannot supply arbitrary coefficients or stale evidence. */
export async function adoptRunbookWeights(input: unknown, actor: IntelligenceActor) {
  const parsed = parseOrThrow(
    z
      .object({
        suggestionId: z.string().regex(/^[a-f0-9]{32}$/),
        expectedHeadVersion: z.number().int().nonnegative(),
      })
      .strict(),
    input
  );
  // The recomputed proposal replaces the stored one, so a refresh after a conflict shows the current one.
  const suggestion = await refreshRunbookWeightProposal();
  if (!suggestion || suggestion.id !== parsed.suggestionId)
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'The runbook-ranking proposal changed. Refresh to review the current evidence.',
    });
  const current = await resolveEffectivePolicy(null);
  return publishPolicyVersion(
    {},
    {
      mode: current.mode,
      expectedHeadVersion: parsed.expectedHeadVersion,
      definition: {
        ...current.definition,
        response: { ...current.definition.response, runbookWeights: suggestion.weights },
      },
      reason: `Reviewed runbook-ranking weights from ${suggestion.support} labelled recommendations (${suggestion.fromOutcomes} outcomes, ${suggestion.fromFeedback} verdicts); held-out loss ${suggestion.heldOutLoss.toFixed(4)} vs ${suggestion.baselineLoss.toFixed(4)}.`,
    },
    actor
  );
}
