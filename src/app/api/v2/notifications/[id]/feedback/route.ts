import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { apiV2Error, apiV2Success, authenticateV2Request, enforceV2Authorization, enforceV2RateLimit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

const MAX_KEYS = 100;
const MAX_EVENTS = 50;

/** Correlate provider feedback through internal message IDs without revealing those IDs. */
export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.NOTIFICATION_READ);
    const { id } = await params;
    if (!id || id.length > 100) throw new AppError({ code: 'VALIDATION_FAILED' });
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: {
        deliveryProvider: true, providerMessageId: true,
        deliveryAttempts: {
          where: { providerMessageId: { not: null } },
          orderBy: [{ ordinal: 'desc' }, { id: 'desc' }],
          take: MAX_KEYS + 1,
          select: { provider: true, providerMessageId: true },
        },
      },
    });
    if (!notification) throw new AppError({ code: 'NOTIFICATION_NOT_FOUND' });
    const candidates = [
      { provider: notification.deliveryProvider, providerMessageId: notification.providerMessageId },
      ...notification.deliveryAttempts.slice(0, MAX_KEYS),
    ];
    const unique = new Map<string, { provider: string; providerMessageId: string }>();
    for (const candidate of candidates) {
      if (!candidate.provider || !candidate.providerMessageId) continue;
      const key = `${candidate.provider}\0${candidate.providerMessageId}`;
      unique.set(key, { provider: candidate.provider, providerMessageId: candidate.providerMessageId });
    }
    const pairs = [...unique.values()].slice(0, MAX_KEYS);
    const where: Prisma.NotificationProviderFeedbackWhereInput = { OR: pairs };
    const rows = pairs.length === 0 ? [] : await prisma.notificationProviderFeedback.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: MAX_EVENTS + 1,
      select: {
        id: true, provider: true, eventType: true, occurredAt: true,
        processedAt: true, quarantinedAt: true,
      },
    });
    return apiV2Success({
      notificationId: id,
      events: rows.slice(0, MAX_EVENTS).map(row => ({
        ...row,
        eventType: /^[A-Z][A-Z0-9_]{1,63}$/.test(row.eventType) ? row.eventType : 'UNKNOWN',
      })),
      truncated: {
        correlation: notification.deliveryAttempts.length > MAX_KEYS || unique.size > MAX_KEYS,
        events: rows.length > MAX_EVENTS,
      },
    }, { headers: { ...rlHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
