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
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);

    const { id } = await params;
    const incident = await prisma.incident.findUnique({
      where: { id },
      include: {
        service: { select: { id: true, name: true, teamId: true } },
        watchers: { select: { userId: true } },
      },
    });

    if (!incident) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        status: 404,
        userMessage: `Incident with id '${id}' was not found.`,
      });
    }

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ, {
      type: 'incident',
      assigneeId: incident.assigneeId,
      watcherIds: incident.watchers.map(w => w.userId),
      visibility: incident.visibility,
      serviceTeamId: incident.service.teamId,
      assignedTeamId: incident.teamId,
    });

    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);

    const cursorWhere = buildCursorWhere(cursor);
    const where: Prisma.IncidentEventWhereInput = {
      incidentId: id,
      ...(cursorWhere.OR ? (cursorWhere as Prisma.IncidentEventWhereInput) : {}),
    };

    const events = await prisma.incidentEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        type: true,
        message: true,
        actorId: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    });

    const result = formatCursorPagination(events, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
