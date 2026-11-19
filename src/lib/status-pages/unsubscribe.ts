import prisma from '@/lib/prisma';
import { statusPageSlugMatches } from '@/lib/status-page-resolver';
import { findUnsubscribeSubscription } from '@/lib/status-pages/subscription-tokens';
import { REVOCABLE_SUBSCRIPTION_STATES } from '@/lib/status-pages/subscription-policy';

/**
 * Revokes a subscription by its unsubscribe token and skips anything still queued for it.
 * Idempotent: an already-unsubscribed token resolves to the same subscription.
 */
export async function unsubscribeByToken(token: string, expectedSlug?: string) {
  if (!token) return null;
  const subscription = await findUnsubscribeSubscription(token);
  if (!subscription || !statusPageSlugMatches(subscription.statusPage.slug, expectedSlug || undefined)) {
    return null;
  }
  await prisma.$transaction([
    prisma.statusPageSubscription.updateMany({
      where: { id: subscription.id, state: { in: REVOCABLE_SUBSCRIPTION_STATES } },
      data: { unsubscribedAt: new Date(), state: 'UNSUBSCRIBED' },
    }),
    // Complained/bounced/suppressed rows record the unsubscribe but keep their suppression.
    prisma.statusPageSubscription.updateMany({
      where: {
        id: subscription.id,
        unsubscribedAt: null,
        state: { notIn: REVOCABLE_SUBSCRIPTION_STATES },
      },
      data: { unsubscribedAt: new Date() },
    }),
    prisma.notification.updateMany({
      where: {
        recipientType: 'SUBSCRIBER',
        recipientId: subscription.id,
        status: { in: ['PENDING', 'FAILED'] },
      },
      data: {
        status: 'SKIPPED',
        payloadEncrypted: null,
        errorMsg: 'Subscription was revoked before delivery.',
      },
    }),
  ]);
  return subscription;
}
