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
  idempotencyResponseHeaders,
  runV2IdempotentAuditedMutation,
  parsePaginationParams,
  TeamCreateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.TEAM_READ);

    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const search = searchParams.get('search')?.trim();

    const filters: Prisma.TeamWhereInput[] = [];
    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.TeamWhereInput);
    }

    const where: Prisma.TeamWhereInput = filters.length > 0 ? { AND: filters } : {};

    const teams = await prisma.team.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            members: true,
            services: true,
          },
        },
      },
    });

    const mapped = teams.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      memberCount: t._count.members,
      serviceCount: t._count.services,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    const result = formatCursorPagination(mapped, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const POST = withV2Observability(async function POST(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.TEAM_MANAGE);

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = TeamCreateV2Schema.parse(body);

    const execution = await runV2IdempotentAuditedMutation(
      req,
      apiKey.id,
      'team:create',
      validated,
      tx =>
        tx.team.create({
          data: {
            name: validated.name,
            description: validated.description ?? null,
          },
          select: {
            id: true,
            name: true,
            description: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      created => ({
        action: 'team.created',
        entityType: 'TEAM',
        entityId: created.id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { name: created.name },
      })
    );

    const team = execution.value;

    return apiV2Created(team, {
      headers: { ...rlHeaders, ...idempotencyResponseHeaders(execution.replayed) },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
