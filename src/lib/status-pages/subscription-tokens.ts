import { createHash, createHmac, randomBytes } from 'node:crypto';
import prisma from '@/lib/prisma';
import { getEncryptionKey } from '@/lib/encryption';

export function hashSubscriptionToken(token: string) {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

/** A separate hash per delivered link keeps older notification links usable. */
export async function issueUnsubscribeToken(subscriptionId: string) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashSubscriptionToken(token);
  await prisma.$executeRaw`
    INSERT INTO "StatusPageSubscriptionToken" ("tokenHash", "subscriptionId")
    VALUES (${tokenHash}, ${subscriptionId})
  `;
  return token;
}

/**
 * With a `scope` (the fan-out's event), a subscriber's token is derived from it, so a retried
 * fan-out issues the same link and adds no row. Without one, or without a server key, it is random.
 */
export async function issueUnsubscribeTokensBatch(
  subscriptionIds: readonly string[],
  scope?: string
) {
  const key = scope ? getEncryptionKey() : null;
  const issued = subscriptionIds.map(subscriptionId => {
    const token = key
      ? createHmac('sha256', key)
          .update(`opsknight:status-unsubscribe:v1:${subscriptionId}:${scope}`)
          .digest('hex')
      : randomBytes(32).toString('hex');
    return { subscriptionId, token, tokenHash: hashSubscriptionToken(token) };
  });
  if (issued.length > 0) {
    await prisma.statusPageSubscriptionToken.createMany({
      data: issued.map(({ subscriptionId, tokenHash }) => ({ subscriptionId, tokenHash })),
      skipDuplicates: true,
    });
  }
  return new Map(issued.map(({ subscriptionId, token }) => [subscriptionId, token]));
}

export async function findUnsubscribeSubscription(token: string) {
  if (!token || token.length > 256) return null;
  const hash = hashSubscriptionToken(token);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "StatusPageSubscription" WHERE "token" = ${hash}
    UNION ALL
    SELECT "subscriptionId" AS "id" FROM "StatusPageSubscriptionToken" WHERE "tokenHash" = ${hash}
    LIMIT 1
  `;
  return rows[0]
    ? prisma.statusPageSubscription.findUnique({
        where: { id: rows[0].id },
        include: { statusPage: true },
      })
    : null;
}
