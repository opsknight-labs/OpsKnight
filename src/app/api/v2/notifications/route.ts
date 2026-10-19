import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  buildCursorWhere,
  enforceV2Authorization,
  enforceV2RateLimit,
  formatCursorPagination,
  parsePaginationParams,
} from '@/lib/api-v2';
import { authorize, AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { NotificationChannel, NotificationStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.NOTIFICATION_READ);
    // Policy: delivery history is operator data. ADMIN/RESPONDER (global) see delivery
    // detail; AUDITOR (resource-scoped read) sees delivery metadata only. USER has no
    // access through the API at all, so there is deliberately no "own notifications" branch.
    const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.NOTIFICATION_READ });
    const canReadDeliveryDetail = decision.allowed && decision.scope === 'global';

    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);

    // Validate against the real enums: an unknown value is a 400, never a Prisma error (500).
    const { channel, status } = z
      .object({
        channel: z.nativeEnum(NotificationChannel).optional(),
        status: z.nativeEnum(NotificationStatus).optional(),
      })
      .parse({
        channel: searchParams.get('channel')?.trim() || undefined,
        status: searchParams.get('status')?.trim() || undefined,
      });
    const incidentId = searchParams.get('incidentId')?.trim();
    const userId = searchParams.get('userId')?.trim();

    const filters: Prisma.NotificationWhereInput[] = [];

    if (userId) filters.push({ userId });

    if (channel) filters.push({ channel });
    if (status) filters.push({ status });
    if (incidentId) filters.push({ incidentId });

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.NotificationWhereInput);
    }

    const where: Prisma.NotificationWhereInput = filters.length > 0 ? { AND: filters } : {};

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        channel: true,
        status: true,
        recipientId: true,
        recipientDisplay: true,
        message: true,
        incidentId: true,
        userId: true,
        createdAt: true,
        incident: { select: { id: true, title: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const visible = canReadDeliveryDetail
      ? notifications
      : notifications.map(
          ({
            message: _message,
            recipientId: _recipientId,
            recipientDisplay: _display,
            user,
            ...rest
          }) => ({
            ...rest,
            user: user ? { id: user.id, name: user.name } : null,
          })
        );

    const result = formatCursorPagination(visible, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
