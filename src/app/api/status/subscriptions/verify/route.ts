import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import { statusPageSlugMatches } from '@/lib/status-page-resolver';
import { hashSubscriptionToken } from '@/lib/status-pages/subscription-tokens';

export const dynamic = 'force-dynamic';

function isVerificationExpired(subscription: {
  verificationTokenExpiresAt?: Date | null;
}): boolean {
  if (!subscription.verificationTokenExpiresAt) return false;
  return new Date(subscription.verificationTokenExpiresAt).getTime() < Date.now();
}

export async function POST(req: NextRequest) {
  let token = '';
  let slug = '';

  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = await req.json();
      token = String(body.token || '');
      slug = String(body.slug || '');
    } catch {}
  } else {
    try {
      const form = await req.formData();
      token = String(form.get('token') || '');
      slug = String(form.get('slug') || '');
    } catch {}
  }

  const parsed = z
    .object({ token: z.string().min(1).max(256), slug: z.string().max(80).optional() })
    .safeParse({ token, slug });

  if (!parsed.success) {
    return NextResponse.redirect(new URL('/status', req.url), 303);
  }

  const subscription = await prisma.statusPageSubscription.findFirst({
    where: { verificationToken: hashSubscriptionToken(parsed.data.token), unsubscribedAt: null },
    include: { statusPage: true },
  });

  if (
    !subscription ||
    !statusPageSlugMatches(subscription.statusPage.slug, parsed.data.slug || undefined)
  ) {
    return NextResponse.redirect(new URL('/status', req.url), 303);
  }

  if (
    isVerificationExpired(subscription as unknown as { verificationTokenExpiresAt: Date | null })
  ) {
    await prisma.statusPageSubscription.updateMany({
      where: { id: subscription.id, verificationToken: hashSubscriptionToken(parsed.data.token) },
      data: { verificationToken: null, verificationTokenExpiresAt: null },
    });
    return NextResponse.redirect(new URL('/status', req.url), 303);
  }

  // If this was an ACTIVE subscriber's pending preference change, atomically install it.
  const prefs = subscription.preferences as Record<string, unknown> | null;
  const pendingPrefs = prefs?._pendingPreferences as
    | { selectedServiceIds?: string[] }
    | null
    | undefined;
  const pendingServiceIds = prefs?._pendingServiceIds as string[] | null | undefined;
  if (subscription.state === 'ACTIVE' && pendingPrefs !== undefined) {
    const newPrefs = pendingPrefs as unknown as Record<string, unknown> | null;
    const {
      _pendingPreferences: _a,
      _pendingServiceIds: _b,
      ...rest
    } = (prefs ?? {}) as Record<string, unknown>;
    const cleanPrefs =
      newPrefs !== undefined ? (newPrefs as unknown as Record<string, unknown>) : rest;
    await prisma.$transaction(async tx => {
      await tx.statusPageSubscription.update({
        where: { id: subscription.id },
        data: {
          preferences: cleanPrefs as unknown as Prisma.InputJsonValue,
          verificationToken: null,
          verificationTokenExpiresAt: null,
        },
      });
      await tx.statusPageSubscriptionService.deleteMany({
        where: { subscriptionId: subscription.id },
      });
      if (Array.isArray(pendingServiceIds) && pendingServiceIds.length > 0) {
        await tx.statusPageSubscriptionService.createMany({
          data: pendingServiceIds.map(serviceId => ({
            subscriptionId: subscription.id,
            serviceId,
          })),
          skipDuplicates: true,
        });
      } else if (
        newPrefs !== null &&
        typeof newPrefs === 'object' &&
        Array.isArray((newPrefs as Record<string, unknown>).selectedServiceIds)
      ) {
        const ids = (newPrefs as { selectedServiceIds: string[] }).selectedServiceIds;
        if (ids.length > 0) {
          await tx.statusPageSubscriptionService.createMany({
            data: ids.map(serviceId => ({ subscriptionId: subscription.id, serviceId })),
            skipDuplicates: true,
          });
        }
      }
    });
  } else {
    await prisma.statusPageSubscription.updateMany({
      where: {
        id: subscription.id,
        verificationToken: hashSubscriptionToken(parsed.data.token),
        unsubscribedAt: null,
      },
      data: {
        verified: true,
        state: 'ACTIVE',
        verificationToken: null,
        verificationTokenExpiresAt: null,
      },
    });
  }

  const destination = getStatusPagePublicUrl(subscription.statusPage);
  return NextResponse.redirect(new URL(destination, req.url), 303);
}
