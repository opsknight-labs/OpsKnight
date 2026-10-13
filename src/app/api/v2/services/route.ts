import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  buildCursorWhere,
  enforceV2Authorization,
  enforceV2RateLimit,
  formatCursorPagination,
  logV2Audit,
  parsePaginationParams,
  ServiceCreateV2Schema,
  ServiceListQuerySchema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_READ);

    const { searchParams } = new URL(req.url);
    const query = ServiceListQuerySchema.parse(Object.fromEntries(searchParams.entries()));
    const { limit, cursor } = parsePaginationParams(searchParams);

    const accessWhere = serviceReadWhere(actor);
    const filters: Prisma.ServiceWhereInput[] = [accessWhere];

    if (query.teamId) filters.push({ teamId: query.teamId });
    if (query.status) filters.push({ status: query.status });
    if (query.search) {
      filters.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.ServiceWhereInput);
    }

    const where: Prisma.ServiceWhereInput = { AND: filters };

    const services = await prisma.service.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        teamId: true,
        escalationPolicyId: true,
        createdAt: true,
        updatedAt: true,
        team: { select: { id: true, name: true } },
        escalationPolicy: { select: { id: true, name: true } },
        _count: {
          select: {
            incidents: {
              where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
            },
          },
        },
      },
    });

    const mapped = services.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      status: s.status,
      teamId: s.teamId,
      team: s.team,
      escalationPolicyId: s.escalationPolicyId,
      escalationPolicy: s.escalationPolicy,
      openIncidentsCount: s._count.incidents,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    const result = formatCursorPagination(mapped, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_CREATE);

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', status: 400, userMessage: 'Invalid JSON request body.' });
    });

    const validated = ServiceCreateV2Schema.parse(body);

    // Verify team exists
    const team = await prisma.team.findUnique({
      where: { id: validated.teamId },
      select: { id: true, name: true },
    });
    if (!team) {
      throw new AppError({
        code: 'TEAM_NOT_FOUND',
        status: 404,
        userMessage: `Team with id '${validated.teamId}' not found.`,
      });
    }

    // Verify escalation policy exists
    const policy = await prisma.escalationPolicy.findUnique({
      where: { id: validated.escalationPolicyId },
      select: { id: true, name: true },
    });
    if (!policy) {
      throw new AppError({
        code: 'ESCALATION_POLICY_NOT_FOUND',
        status: 404,
        userMessage: `Escalation policy with id '${validated.escalationPolicyId}' not found.`,
      });
    }

    const created = await prisma.service.create({
      data: {
        name: validated.name,
        description: validated.description ?? null,
        teamId: validated.teamId,
        escalationPolicyId: validated.escalationPolicyId,
        status: validated.status,
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        teamId: true,
        escalationPolicyId: true,
        createdAt: true,
        updatedAt: true,
        team: { select: { id: true, name: true } },
        escalationPolicy: { select: { id: true, name: true } },
      },
    });

    await logV2Audit({
      action: 'service.created',
      entityType: 'SERVICE',
      entityId: created.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: {
        name: created.name,
        teamId: created.teamId,
        escalationPolicyId: created.escalationPolicyId,
      },
    });

    return apiV2Created(created, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
