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
import type { AuditEntityType, Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'SEARCH_EXPORT');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.AUDIT_READ);

    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);

    const action = searchParams.get('action')?.trim();
    const entityType = searchParams.get('entityType')?.trim();
    const entityId = searchParams.get('entityId')?.trim();
    const actorId = searchParams.get('actorId')?.trim();

    const filters: Prisma.AuditLogWhereInput[] = [];
    if (action) filters.push({ action: { contains: action, mode: 'insensitive' } });
    if (entityType) filters.push({ entityType: entityType as AuditEntityType });
    if (entityId) filters.push({ entityId });
    if (actorId) filters.push({ actorId });

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.AuditLogWhereInput);
    }

    const where: Prisma.AuditLogWhereInput = filters.length > 0 ? { AND: filters } : {};

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorId: true,
        actorEmail: true,
        actorName: true,
        details: true,
        ip: true,
        createdAt: true,
      },
    });

    const result = formatCursorPagination(logs, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
