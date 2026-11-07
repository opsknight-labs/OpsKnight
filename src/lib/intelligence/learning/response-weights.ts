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
}

export interface ResponseWeightsProposal {
  weights: ResponseWeights;
  heldOutLoss: number;
  baselineLoss: number;
  support: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));

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
  rows.reduce((sum, row) => {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, predict(row, weights)));
    return sum - Math.log(row.helpful ? p : 1 - p);
  }, 0) / rows.length;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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
  if (
    rows.length < 40 ||
    rows.filter(r => r.helpful).length < 8 ||
    rows.filter(r => !r.helpful).length < 8
  )
    return null;
  const train = rows.filter((_, i) => i % 5 !== 0);
  const held = rows.filter((_, i) => i % 5 === 0);
  if (new Set(held.map(row => row.helpful)).size < 2) return null;
  let weights: ResponseWeights = {
    kind: { ...DEFAULT_RESPONSE_WEIGHTS.kind },
    upstreamDecay: DEFAULT_RESPONSE_WEIGHTS.upstreamDecay,
    globalWeight: DEFAULT_RESPONSE_WEIGHTS.globalWeight,
  };
  const steps = [0.1, 0.05, 0.02];
  for (const step of steps) {
    for (let pass = 0; pass < 10; pass += 1) {
      let improved = false;
      const candidates: Array<(w: ResponseWeights, delta: number) => ResponseWeights> = [
        (w, d) => ({ ...w, upstreamDecay: clamp(w.upstreamDecay + d, 0.3, 1) }),
        (w, d) => ({ ...w, globalWeight: clamp(w.globalWeight + d, 0.1, 1) }),
        ...(['DEPLOY', 'CONFIG', 'FEATURE_FLAG', 'INFRA'] as const).map(
          kind => (w: ResponseWeights, d: number) => ({
            ...w,
            kind: { ...w.kind, [kind]: clamp(w.kind[kind] + d, 0.2, 1) },
          })
        ),
      ];
      for (const candidate of candidates) {
        const current = loss(train, weights);
        for (const delta of [step, -step]) {
          const next = candidate(weights, delta);
          if (loss(train, next) < current - 1e-6) {
            weights = next;
            improved = true;
            break;
          }
        }
      }
      if (!improved) break;
    }
  }
  const heldOutLoss = loss(held, weights);
  const baselineLoss = loss(held, DEFAULT_RESPONSE_WEIGHTS);
  return heldOutLoss < baselineLoss - 0.01
    ? {
        weights: responseWeightsSchema.parse(weights),
        heldOutLoss,
        baselineLoss,
        support: rows.length,
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

export async function suggestResponseWeights() {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; kind: string; evidence: Prisma.JsonValue; helpful: boolean }>
  >`
    SELECT DISTINCT ON (f."id") f."id", f."kind", f."evidence", fb."verdict" IN ('HELPFUL', 'CORRECT') AS helpful
    FROM "IntelligenceFeedback" fb JOIN "IntelligenceFinding" f ON f."id" = fb."subjectId"
    WHERE fb."subjectType" = 'FINDING' AND f."kind" IN ('CHANGE_CORRELATION', 'PROBABLE_CAUSE')
      AND fb."verdict" IN ('HELPFUL', 'NOT_HELPFUL', 'CORRECT', 'INCORRECT')
      AND fb."createdAt" >= now() - interval '90 days'
    ORDER BY f."id", fb."createdAt" DESC LIMIT 2000`;
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
  const suggestion = await suggestResponseWeights();
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
      reason: `Reviewed cause-ranking weights from ${suggestion.support} labelled causes; held-out loss ${suggestion.heldOutLoss.toFixed(4)} vs ${suggestion.baselineLoss.toFixed(4)}.`,
    },
    actor
  );
}
