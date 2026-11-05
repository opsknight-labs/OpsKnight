import prisma from '@/lib/prisma';
import { statusPageSlugMatches } from '@/lib/status-page-resolver';
import { findUnsubscribeSubscription } from '@/lib/status-pages/subscription-tokens';

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
      where: { id: subscription.id, unsubscribedAt: null },
      data: { unsubscribedAt: new Date(), state: 'UNSUBSCRIBED' },
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
