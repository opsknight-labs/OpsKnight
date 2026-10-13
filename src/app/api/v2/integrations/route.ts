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
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_READ);

    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const serviceId = searchParams.get('serviceId')?.trim();
    const type = searchParams.get('type')?.trim();

    const filters: Prisma.IntegrationWhereInput[] = [];
    if (serviceId) filters.push({ serviceId });
    if (type) filters.push({ type });

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.IntegrationWhereInput);
    }

    const where: Prisma.IntegrationWhereInput = filters.length > 0 ? { AND: filters } : {};

    const integrations = await prisma.integration.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        type: true,
        serviceId: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        service: {
          select: { id: true, name: true },
        },
      },
    });

    const result = formatCursorPagination(integrations, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
