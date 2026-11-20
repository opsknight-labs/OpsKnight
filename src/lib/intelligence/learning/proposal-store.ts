import 'server-only';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod/v4';
import prisma from '@/lib/prisma';

/**
 * Similarity and cause weight proposals fitted by the daily lane job (see runbook-weights.ts), so the
 * settings page reads one row each instead of fitting on render. One IntelligencePattern row per kind.
 */
export const STORED_PROPOSAL_KINDS = [
  'SCORING_WEIGHTS_PROPOSAL',
  'RESPONSE_WEIGHTS_PROPOSAL',
] as const;
export type StoredProposalKind = (typeof STORED_PROPOSAL_KINDS)[number];

const row = (kind: StoredProposalKind) => ({ scopeKey: 'global', kind, key: 'latest' });

export async function storeWeightProposal(
  kind: StoredProposalKind,
  proposal: { support: number } | null,
  client: Pick<Prisma.TransactionClient, 'intelligencePattern'> = prisma
) {
  const stats = { proposal } as unknown as Prisma.InputJsonValue;
  const support = proposal?.support ?? 0;
  await client.intelligencePattern.upsert({
    where: { scopeKey_kind_key: row(kind) },
    create: { ...row(kind), stats, support },
    update: { stats, support, lastSeenAt: new Date() },
  });
}

/** The stored proposal when it still has the shape the page renders; null when absent or malformed. */
export async function readWeightProposal<T>(
  kind: StoredProposalKind,
  weightsSchema: z.ZodType
): Promise<T | null> {
  const found = await prisma.intelligencePattern.findUnique({
    where: { scopeKey_kind_key: row(kind) },
    select: { stats: true },
  });
  const stored = (found?.stats as { proposal?: Record<string, unknown> | null } | null)?.proposal;
  const valid =
    stored &&
    typeof stored.id === 'string' &&
    typeof stored.support === 'number' &&
    typeof stored.heldOutLoss === 'number' &&
    typeof stored.baselineLoss === 'number' &&
    weightsSchema.safeParse(stored.weights).success;
  return valid ? (stored as T) : null;
}
