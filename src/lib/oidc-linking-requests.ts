import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createInAppNotifications } from '@/lib/in-app-notifications';

/** Remind administrators again only if a request is still waiting after a day. */
const RENOTIFY_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_NOTIFIED_ADMINISTRATORS = 100;

/**
 * Turns "your administrator must approve you" into an actual request: administrators get an
 * in-app notification that opens the approval screen, and repeated attempts update the same
 * request instead of notifying again.
 *
 * Only called after the identity provider authenticated the person and proved the email, so it
 * never reveals or creates anything for an unauthenticated caller.
 */
export async function recordOidcLinkingRequest(
  email: string,
  reason: 'OIDC_LINK_NOT_APPROVED' | 'OIDC_LINK_APPROVAL_EXPIRED'
): Promise<boolean> {
  try {
    const user = await prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        status: { in: ['ACTIVE', 'INVITED'] },
      },
      select: { id: true, name: true, email: true },
    });
    if (!user) return false;
    const now = new Date();
    await prisma.oidcLinkingRequest.upsert({
      where: { userId: user.id },
      create: { userId: user.id, email: user.email, reason },
      update: { reason, lastAttemptAt: now, attempts: { increment: 1 } },
    });
    // Every attempt notifies; the per-day dedupe key below makes repeats within the same day
    // no-ops, so administrators are reminded once a day while the person keeps trying.
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: MAX_NOTIFIED_ADMINISTRATORS,
    });
    const who = user.name ? `${user.name} (${user.email})` : user.email;
    await createInAppNotifications({
      userIds: admins.map(admin => admin.id),
      type: 'TEAM',
      title: 'SSO access request',
      message:
        reason === 'OIDC_LINK_APPROVAL_EXPIRED'
          ? `${who} tried to sign in with SSO, but their approval expired. Renew it to let them in.`
          : `${who} tried to sign in with SSO for the first time and needs your approval.`,
      entityType: 'SSO_LINK_REQUEST',
      entityId: user.id,
      dedupeKey: `sso-link-request:${user.id}:${Math.floor(now.getTime() / RENOTIFY_AFTER_MS)}`,
    });
    return true;
  } catch (error) {
    logger.warn('[OIDC] Could not record SSO access request', {
      component: 'oidc-linking-requests',
      error,
    });
    return false;
  }
}
