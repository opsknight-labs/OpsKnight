/* eslint-disable security/detect-object-injection -- Indexed keys come from the fixed change-kind allowlist. */
import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { type ResponseWeights, responseWeightsSchema } from '../contract';
import { DEFAULT_RESPONSE_WEIGHTS } from '../root-cause/scoring';
import {
  parseOrThrow,
  publishPolicyVersion,
  resolveEffectivePolicy,
  type IntelligenceActor,
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
import { readWeightProposal, storeWeightProposal } from './proposal-store';

/**
 * Offline fitting of probable-cause ranking weights from responder feedback on cause findings. Each
 * labelled finding contributes its stored evidence (kind, relation, depth); the fit nudges the per-kind
 * and relation multipliers towards the values that best separate helpful from unhelpful causes, within
 * the bounds the policy schema allows, and is offered only when it beats the shipped defaults on held-out
 * pairs. Nothing is applied automatically: a person publishes it as a policy version.
 */

export interface CauseExample {
  kind: 'DEPLOY' | 'CONFIG' | 'FEATURE_FLAG' | 'INFRA' | 'INCIDENT';
  relation: 'SAME_SERVICE' | 'UPSTREAM' | 'GLOBAL';
  depth: number;
  /** The proximity and chance components, already in 0..1. */
  proximity: number;
  chance: number;
  helpful: boolean;
  /** Inferred from a rollback or a postmortem, not stated by a responder; carries a lower weight. */
  implicit?: boolean;
  weight?: number;
}

export interface ResponseWeightsProposal {
  weights: ResponseWeights;
  heldOutLoss: number;
  baselineLoss: number;
  support: number;
  /** Of `support`, labels inferred from rollbacks and postmortems. */
  fromImplicit: number;
}

function predict(example: CauseExample, weights: ResponseWeights): number {
  const relation =
    example.relation === 'SAME_SERVICE'
      ? 1
      : example.relation === 'GLOBAL'
        ? weights.globalWeight
        : Math.pow(weights.upstreamDecay, Math.max(1, example.depth));
  const kind = example.kind === 'INCIDENT' ? 0.85 : weights.kind[example.kind];
  return sigmoid(6 * (example.proximity * relation * kind * example.chance - 0.35));
}

const loss = (rows: readonly CauseExample[], weights: ResponseWeights) =>
  logLoss(rows, weights, predict);

/** Coordinate-descent over the bounded multipliers; offered only if held-out loss improves. */
export function fitResponseWeights(
  examples: readonly CauseExample[]
): ResponseWeightsProposal | null {
  const rows = examples.filter(
    row =>
      Number.isFinite(row.proximity) &&
      Number.isFinite(row.chance) &&
      row.proximity >= 0 &&
      row.chance > 0
  );
  if (!hasMinimumSupport(rows, { rows: 40, perVerdict: 8 })) return null;
  const { train, held } = holdOutSplit(rows);
  if (new Set(held.map(row => row.helpful)).size < 2) return null;
  const weights = coordinateDescent<ResponseWeights>(
    {
      kind: { ...DEFAULT_RESPONSE_WEIGHTS.kind },
      upstreamDecay: DEFAULT_RESPONSE_WEIGHTS.upstreamDecay,
      globalWeight: DEFAULT_RESPONSE_WEIGHTS.globalWeight,
    },
    [
      (w, d) => ({ ...w, upstreamDecay: clamp(w.upstreamDecay + d, 0.3, 1) }),
      (w, d) => ({ ...w, globalWeight: clamp(w.globalWeight + d, 0.1, 1) }),
      ...(['DEPLOY', 'CONFIG', 'FEATURE_FLAG', 'INFRA'] as const).map(
        kind => (w: ResponseWeights, d: number) => ({
          ...w,
          kind: { ...w.kind, [kind]: clamp(w.kind[kind] + d, 0.2, 1) },
        })
      ),
    ],
    candidate => loss(train, candidate)
  );
  const heldOutLoss = loss(held, weights);
  const baselineLoss = loss(held, DEFAULT_RESPONSE_WEIGHTS);
  return heldOutLoss < baselineLoss - 0.01
    ? {
        weights: responseWeightsSchema.parse(weights),
        heldOutLoss,
        baselineLoss,
        support: rows.length,
        fromImplicit: rows.filter(row => row.implicit).length,
      }
    : null;
}

const evidenceSchema = z.object({
  kind: z.enum(['DEPLOY', 'CONFIG', 'FEATURE_FLAG', 'INFRA']).optional(),
  relation: z.enum(['SAME_SERVICE', 'UPSTREAM', 'GLOBAL']).optional(),
  depth: z.number().optional(),
  chanceFactor: z.number().optional(),
  components: z.object({ proximity: z.number() }),
});

type CauseLabelRow = {
  id: string;
  kind: string;
  evidence: Prisma.JsonValue;
  helpful: boolean;
  implicit?: boolean;
};

/**
 * Implicit positive labels for change findings that carry no responder verdict: the suspected change was
 * the latest of its kind on its service before the incident and was rolled back within a day, or the
 * incident's postmortem root cause names the change (its version or summary). Never a negative label.
 */
export async function loadImplicitCauseLabels(
  client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma
) {
  return client.$queryRaw<CauseLabelRow[]>`
    SELECT f."id", f."kind", f."evidence", true AS helpful, true AS implicit
    FROM "IntelligenceFinding" f
    JOIN "Incident" i ON i."id" = f."incidentId"
    JOIN "ChangeEvent" c ON c."id" = f."subjectRef"
    WHERE f."kind" = 'CHANGE_CORRELATION' AND f."createdAt" >= now() - interval '90 days'
      AND NOT EXISTS (
        SELECT 1 FROM "IntelligenceFeedback" fb WHERE fb."subjectType" = 'FINDING' AND fb."subjectId" = f."id")
      AND (
        (c."occurredAt" <= i."createdAt"
          AND NOT EXISTS (
            SELECT 1 FROM "ChangeEvent" later WHERE later."serviceId" = c."serviceId" AND later."kind" = c."kind"
              AND later."occurredAt" > c."occurredAt" AND later."occurredAt" <= i."createdAt")
          AND EXISTS (
            SELECT 1 FROM "ChangeEvent" r WHERE r."serviceId" = c."serviceId" AND r."kind" = c."kind"
              AND r."occurredAt" > i."createdAt" AND r."occurredAt" <= i."createdAt" + interval '24 hours'
              AND (lower(r."labels"->>'rollback') = 'true'
                OR lower(r."labels"->>'action') IN ('rollback', 'revert')
                OR r."summary" ~* '^(rollback|roll back|revert)')))
        OR EXISTS (
          SELECT 1 FROM "Postmortem" p WHERE p."incidentId" = i."id" AND p."rootCause" IS NOT NULL
            AND ((length(c."version") >= 3 AND strpos(lower(p."rootCause"), lower(c."version")) > 0)
              OR (length(c."summary") >= 8 AND strpos(lower(p."rootCause"), lower(c."summary")) > 0))))
    ORDER BY f."id" LIMIT 2000`;
}

export async function suggestResponseWeights(
  client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma
) {
  const explicit = await client.$queryRaw<CauseLabelRow[]>`
    SELECT DISTINCT ON (f."id") f."id", f."kind", f."evidence", fb."verdict" IN ('HELPFUL', 'CORRECT') AS helpful
    FROM "IntelligenceFeedback" fb JOIN "IntelligenceFinding" f ON f."id" = fb."subjectId"
    WHERE fb."subjectType" = 'FINDING' AND f."kind" IN ('CHANGE_CORRELATION', 'PROBABLE_CAUSE')
      AND fb."verdict" IN ('HELPFUL', 'NOT_HELPFUL', 'CORRECT', 'INCORRECT')
      AND fb."createdAt" >= now() - interval '90 days'
    ORDER BY f."id", fb."createdAt" DESC LIMIT 2000`;
  const rows = [...explicit, ...(await loadImplicitCauseLabels(client))];
  const examples: CauseExample[] = [];
  for (const row of rows) {
    const parsed = evidenceSchema.safeParse(row.evidence);
    if (!parsed.success) continue;
    examples.push({
      kind: row.kind === 'PROBABLE_CAUSE' ? 'INCIDENT' : (parsed.data.kind ?? 'DEPLOY'),
      relation:
        parsed.data.relation ?? (row.kind === 'PROBABLE_CAUSE' ? 'UPSTREAM' : 'SAME_SERVICE'),
      depth: parsed.data.depth ?? 1,
      proximity: parsed.data.components.proximity,
      chance: parsed.data.chanceFactor ?? 1,
      helpful: row.helpful,
      ...(row.implicit ? { implicit: true, weight: IMPLICIT_LABEL_WEIGHT } : {}),
    });
  }
  const proposal = fitResponseWeights(examples);
  if (!proposal) return null;
  return {
    ...proposal,
    id: createHash('sha256')
      .update(JSON.stringify([rows.map(row => [row.id, row.helpful]), proposal.weights]))
      .digest('hex')
      .slice(0, 32),
  };
}

type StoredResponseWeightsProposal = ResponseWeightsProposal & { id: string };

/** Fits now and stores the result for the settings page (null when there is no supported improvement). */
export async function refreshResponseWeightProposal(client: Prisma.TransactionClient = prisma) {
  const proposal = await suggestResponseWeights(client);
  await storeWeightProposal('RESPONSE_WEIGHTS_PROPOSAL', proposal, client);
  return proposal;
}

/** The proposal the daily fit stored: one indexed read, no fit. */
export const readResponseWeightProposal = () =>
  readWeightProposal<StoredResponseWeightsProposal>(
    'RESPONSE_WEIGHTS_PROPOSAL',
    responseWeightsSchema
  );

/** Recompute before publishing: the browser cannot supply arbitrary coefficients or stale evidence. */
export async function adoptResponseWeights(input: unknown, actor: IntelligenceActor) {
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
  const suggestion = await refreshResponseWeightProposal();
  if (!suggestion || suggestion.id !== parsed.suggestionId)
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'The cause-ranking proposal changed. Refresh to review the current evidence.',
    });
  const current = await resolveEffectivePolicy(null);
  return publishPolicyVersion(
    {},
    {
      mode: current.mode,
      expectedHeadVersion: parsed.expectedHeadVersion,
      definition: {
        ...current.definition,
        response: { ...current.definition.response, weights: suggestion.weights },
      },
      reason: `Reviewed cause-ranking weights from ${suggestion.support} labelled causes (${suggestion.fromImplicit} implicit); held-out loss ${suggestion.heldOutLoss.toFixed(4)} vs ${suggestion.baselineLoss.toFixed(4)}.`,
    },
    actor
  );
}
