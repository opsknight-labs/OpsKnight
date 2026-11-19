import type { StatusPageSubscriptionState } from '@prisma/client';

export type SubscriptionRequestAction = 'ACCEPT' | 'REACTIVATE' | 'REFRESH_VERIFICATION';

const VERIFICATION_RESEND_DELAY_MS = 60_000;

/**
 * Only consent states move to UNSUBSCRIBED on revocation. COMPLAINED, BOUNCED and SUPPRESSED are
 * deliverability state and must survive an unsubscribe, or a later sign-up would REACTIVATE them.
 */
export const REVOCABLE_SUBSCRIPTION_STATES: StatusPageSubscriptionState[] = ['PENDING', 'ACTIVE'];

export function subscriptionRequestAction(
  state: StatusPageSubscriptionState,
  subscribedAt: Date,
  nowMs: number
): SubscriptionRequestAction {
  switch (state) {
    case 'UNSUBSCRIBED':
      return 'REACTIVATE';
    case 'PENDING':
      return nowMs - subscribedAt.getTime() < VERIFICATION_RESEND_DELAY_MS
        ? 'ACCEPT'
        : 'REFRESH_VERIFICATION';
    case 'ACTIVE':
    case 'COMPLAINED':
    case 'SUPPRESSED':
    case 'BOUNCED':
      return 'ACCEPT';
  }
}
