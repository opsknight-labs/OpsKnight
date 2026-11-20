import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { combinedContent } from '../similarity/scoring';
import { fitScoringWeights, type ScoringExample } from './weights';
import { readWeightProposal, storeWeightProposal } from './proposal-store';
import { scoringWeightsSchema } from '../contract';
import {
  parseOrThrow,
  publishPolicyVersion,
  resolveEffectivePolicy,
  type IntelligenceActor,
} from '../settings/service';

export async function suggestScoringWeights(
  client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma
) {
  const rows = await client.$queryRaw<
    Array<{ pair: string; evidence: Prisma.JsonValue; helpful: boolean; at: Date }>
  >`
    SELECT DISTINCT ON (f."incidentId", f."subjectRef")
      f."incidentId" || ':' || f."subjectRef" AS pair, f."evidence", fb."verdict" IN ('HELPFUL', 'CORRECT') AS helpful, fb."createdAt" AS at
    FROM "IntelligenceFeedback" fb JOIN "IntelligenceFinding" f ON f."id" = fb."subjectId"
    WHERE fb."subjectType" = 'FINDING' AND f."kind" = 'SIMILAR_INCIDENT'
      AND fb."verdict" IN ('HELPFUL', 'NOT_HELPFUL', 'CORRECT', 'INCORRECT')
      AND fb."createdAt" >= now() - interval '90 days'
    ORDER BY f."incidentId", f."subjectRef", fb."createdAt" DESC LIMIT 2000`;
  const examples: ScoringExample[] = [];
  for (const row of rows) {
    const parsed = z
      .object({
        components: z.object({
          tokens: z.number(),
          template: z.number(),
          semantic: z.number().optional(),
          labels: z.number(),
          sameService: z.number(),
          recency: z.number(),
          resolved: z.number(),
        }),
      })
      .safeParse(row.evidence);
    if (parsed.success)
      examples.push({
        ...parsed.data.components,
        content: combinedContent(parsed.data.components),
        helpful: row.helpful,
        at: row.at.getTime(),
      });
  }
  const proposal = fitScoringWeights(examples);
  if (!proposal) return null;
  return {
    ...proposal,
    id: createHash('sha256')
      .update(JSON.stringify([rows.map(row => [row.pair, row.helpful]), proposal.weights]))
      .digest('hex')
      .slice(0, 32),
  };
}

type ScoringWeightsProposal = NonNullable<Awaited<ReturnType<typeof suggestScoringWeights>>>;

/** Fits now and stores the result for the settings page (null when there is no supported improvement). */
export async function refreshScoringWeightProposal(client: Prisma.TransactionClient = prisma) {
  const proposal = await suggestScoringWeights(client);
  await storeWeightProposal('SCORING_WEIGHTS_PROPOSAL', proposal, client);
  return proposal;
}

/** The proposal the daily fit stored: one indexed read, no fit. */
export const readScoringWeightProposal = () =>
  readWeightProposal<ScoringWeightsProposal>('SCORING_WEIGHTS_PROPOSAL', scoringWeightsSchema);

/** Recompute before publishing: the browser cannot supply arbitrary coefficients or stale evidence. */
export async function adoptScoringWeights(input: unknown, actor: IntelligenceActor) {
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
  const suggestion = await refreshScoringWeightProposal();
  if (!suggestion || suggestion.id !== parsed.suggestionId)
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'The scoring proposal changed. Refresh to review the current evidence.',
    });
  const current = await resolveEffectivePolicy(null);
  return publishPolicyVersion(
    {},
    {
      mode: current.mode,
      expectedHeadVersion: parsed.expectedHeadVersion,
      definition: {
        ...current.definition,
        similarity: { ...current.definition.similarity, weights: suggestion.weights },
      },
      reason: `Reviewed scoring weights from ${suggestion.support} labelled pairs; held-out loss ${suggestion.heldOutLoss.toFixed(4)} vs ${suggestion.baselineLoss.toFixed(4)}.`,
    },
    actor
  );
}
