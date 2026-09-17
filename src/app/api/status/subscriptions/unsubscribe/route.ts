import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { statusPageSlugMatches } from '@/lib/status-page-resolver';
import { findUnsubscribeSubscription } from '@/lib/status-pages/subscription-tokens';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let token = '';
  let expectedSlug = '';

  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = await req.json();
      token = String(body.token || '');
      expectedSlug = String(body.expectedSlug || '');
    } catch {}
  } else {
    try {
      const form = await req.formData();
      token = String(form.get('token') || '');
      expectedSlug = String(form.get('expectedSlug') || '');
    } catch {}
  }

  if (token) {
    const subscription = await findUnsubscribeSubscription(token);
    if (
      subscription &&
      statusPageSlugMatches(subscription.statusPage.slug, expectedSlug || undefined)
    ) {
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

      const publicBase = getStatusPagePublicUrl(subscription.statusPage);
      const destination = `${publicBase.replace(/\/$/, '')}/unsubscribe/${encodeURIComponent(token)}?done=1`;
      return NextResponse.redirect(new URL(destination, req.url), 303);
    }
  }

  return NextResponse.redirect(new URL('/status', req.url), 303);
}
