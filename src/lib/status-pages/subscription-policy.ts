import type { Prisma, StatusPageSubscriptionState } from '@prisma/client';

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

/**
 * Subscribers who should hear about an update touching `serviceIds`: everyone who follows the
 * whole page (no service or business-service picks), anyone who picked one of the services, and
 * anyone who picked a business service containing one of them.
 */
export function subscriberServiceFilter(
  serviceIds: readonly string[]
): Prisma.StatusPageSubscriptionWhereInput {
  const ids = [...serviceIds];
  return {
    OR: [
      { selectedServices: { none: {} }, selectedBusinessServices: { none: {} } },
      { selectedServices: { some: { serviceId: { in: ids } } } },
      {
        selectedBusinessServices: {
          some: { businessService: { members: { some: { serviceId: { in: ids } } } } },
        },
      },
    ],
  };
}
