import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { DEFAULT_SCORECARD_RUBRIC, scorecardRubricSchema, type ScorecardRubric } from './scorecard';

export const SCORECARD_CONFIG_KEY = 'business_service_scorecard';

/** The stored rubric, or the default when none is saved or the stored one no longer validates. */
export function normalizeRubric(value: unknown): ScorecardRubric {
  const parsed = scorecardRubricSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SCORECARD_RUBRIC;
}

export async function getScorecardRubric(
  client: Pick<Prisma.TransactionClient, 'systemConfig'> = prisma
): Promise<ScorecardRubric> {
  const row = await client.systemConfig.findUnique({ where: { key: SCORECARD_CONFIG_KEY } });
  return normalizeRubric(row?.value);
}

/** Replaces the rubric (admins only; the caller authorizes). Scoped teams must exist. Audits old and new. */
export async function saveScorecardRubric(
  input: unknown,
  actor: { id: string; source: AuditEventSource },
  tx?: Prisma.TransactionClient
): Promise<ScorecardRubric> {
  if (!tx) return prisma.$transaction(client => saveScorecardRubric(input, actor, client));
  const next = scorecardRubricSchema.parse(input);
  const teamIds = [...new Set(next.rules.flatMap(rule => rule.teamIds ?? []))];
  if (teamIds.length) {
    const found = await tx.team.findMany({ where: { id: { in: teamIds } }, select: { id: true } });
    const missing = teamIds.filter(id => !found.some(team => team.id === id));
    if (missing.length)
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: `Unknown team in a rule scope: ${missing.join(', ')}`,
      });
  }
  const current = await getScorecardRubric(tx);
  const value = next as unknown as Prisma.InputJsonObject;
  await tx.systemConfig.upsert({
    where: { key: SCORECARD_CONFIG_KEY },
    create: { key: SCORECARD_CONFIG_KEY, value, updatedBy: actor.id },
    update: { value, updatedBy: actor.id },
  });
  await emitAuditEvent(
    {
      action: 'business_service.scorecard_rubric_updated',
      source: actor.source,
      actor: { type: 'USER', id: actor.id },
      target: { type: 'SYSTEM_CONFIG', id: SCORECARD_CONFIG_KEY },
      oldValue: current as unknown as Prisma.InputJsonObject,
      newValue: value,
    },
    tx
  );
  return next;
}
