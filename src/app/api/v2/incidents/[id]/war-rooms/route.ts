import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { apiV2Error, apiV2Success, authenticateV2Request, enforceV2Authorization,
  enforceV2RateLimit, formatCursorPagination, parsePaginationParams } from '@/lib/api-v2';
import { buildCursorWhere } from '@/lib/api-v2/pagination';
import { requireIncidentDiagnosticAccess } from '@/lib/api-v2/incident-diagnostics';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { withV2Observability } from '@/lib/api-v2/observability';

/** Persisted provider state only; no outbound provider call on a responder read. */
export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    const { id } = await params;
    await requireIncidentDiagnosticAccess(actor, id);
    const { limit, cursor } = parsePaginationParams(new URL(req.url).searchParams);
    const where: Prisma.IncidentWarRoomWhereInput = {
      AND: [{ incidentId: id }, buildCursorWhere(cursor)],
    };
    const rows = await prisma.incidentWarRoom.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, incidentId: true, provider: true, generation: true,
        state: true, health: true, providerChannelName: true,
        providerChannelUrl: true, createdAt: true, readyAt: true,
        closedAt: true, archivedAt: true,
        _count: { select: { participants: true } },
      },
    });
    const page = formatCursorPagination(rows, limit);
    return apiV2Success(page.data.map(({ _count, ...room }) => ({
      ...room, participantCount: _count.participants,
    })), {
      pagination: page.pagination,
      headers: { ...rlHeaders, 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
