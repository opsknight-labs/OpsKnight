import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';

type Client = Pick<
  Prisma.TransactionClient,
  'onCallLayerUser' | 'escalationRule' | 'onCallOverride'
>;

/**
 * Stakeholders are never paged, so nobody becomes one while they still hold paging duties:
 * a current or future schedule layer, an escalation step that names them, or an override.
 * Returns the reasons per user; empty when the change is allowed.
 */
export async function pagingDutiesOf(
  userIds: readonly string[],
  client: Client = prisma,
  now = new Date()
): Promise<Map<string, string[]>> {
  const ids = [...userIds];
  if (!ids.length) return new Map();
  const live = { OR: [{ end: null }, { end: { gt: now } }] };
  // Sequential: may run inside an interactive transaction.
  const layers = await client.onCallLayerUser.findMany({
    where: { userId: { in: ids }, layer: live },
    select: { userId: true, layer: { select: { schedule: { select: { name: true } } } } },
  });
  const steps = await client.escalationRule.findMany({
    where: { targetUserId: { in: ids } },
    select: { targetUserId: true, policy: { select: { name: true } } },
  });
  const overrides = await client.onCallOverride.findMany({
    where: { userId: { in: ids }, end: { gt: now } },
    select: { userId: true, schedule: { select: { name: true } } },
  });
  const duties = new Map<string, string[]>();
  const add = (userId: string, reason: string) =>
    duties.set(userId, [...new Set([...(duties.get(userId) ?? []), reason])]);
  for (const row of layers) add(row.userId, `on call in "${row.layer.schedule.name}"`);
  for (const row of overrides) add(row.userId, `taking an override in "${row.schedule.name}"`);
  for (const row of steps)
    if (row.targetUserId)
      add(row.targetUserId, `named in an escalation step of "${row.policy.name}"`);
  return duties;
}

/** Throws a clear VALIDATION_FAILED when `role` is STAKEHOLDER and someone still has paging duties. */
export async function assertCanBecomeStakeholder(
  userIds: readonly string[],
  role: string,
  client: Client = prisma
): Promise<void> {
  if (role !== 'STAKEHOLDER') return;
  const duties = await pagingDutiesOf(userIds, client);
  if (!duties.size) return;
  const [, reasons] = [...duties][0];
  const who = duties.size === 1 ? 'This person is' : `${duties.size} people are`;
  throw new AppError({
    code: 'VALIDATION_FAILED',
    userMessage: `${who} still ${reasons.slice(0, 3).join('; ')}. Stakeholders are never paged: remove them from schedules, overrides and escalation steps first.`,
  });
}

/**
 * For identity-provider driven role changes (SCIM, OIDC sign-in), which must never fail or
 * lock someone out: the duties that block turning this person into a stakeholder, or null
 * when the change may go ahead.
 */
export async function stakeholderConversionBlockers(
  userId: string,
  from: string,
  to: string,
  client: Client = prisma
): Promise<string[] | null> {
  if (to !== 'STAKEHOLDER' || from === 'STAKEHOLDER') return null;
  return (await pagingDutiesOf([userId], client)).get(userId) ?? null;
}
