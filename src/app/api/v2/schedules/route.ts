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
  ScheduleCreateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SCHEDULE_READ);

    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const search = searchParams.get('search')?.trim();

    const accessWhere = scheduleReadWhere(actor);
    const filters: Prisma.OnCallScheduleWhereInput[] = [accessWhere];

    if (search) {
      filters.push({
        name: { contains: search, mode: 'insensitive' },
      });
    }

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.OnCallScheduleWhereInput);
    }

    const where: Prisma.OnCallScheduleWhereInput = { AND: filters };

    const schedules = await prisma.onCallSchedule.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        timeZone: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            layers: true,
            overrides: true,
          },
        },
      },
    });

    const mapped = schedules.map(s => ({
      id: s.id,
      name: s.name,
      timeZone: s.timeZone,
      layerCount: s._count.layers,
      overrideCount: s._count.overrides,
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
});

export const POST = withV2Observability(async function POST(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE);

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = ScheduleCreateV2Schema.parse(body);

    const execution = await runV2IdempotentAuditedMutation(
      req,
      apiKey.id,
      'schedule:create',
      validated,
      tx =>
        tx.onCallSchedule.create({
          data: {
            name: validated.name,
            timeZone: validated.timeZone,
          },
          select: {
            id: true,
            name: true,
            timeZone: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      schedule => ({
        action: 'schedule.created',
        entityType: 'SCHEDULE',
        entityId: schedule.id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { name: schedule.name, timeZone: schedule.timeZone },
      })
    );

    const schedule = execution.value;

    return apiV2Created(schedule, {
      headers: { ...rlHeaders, ...idempotencyResponseHeaders(execution.replayed) },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
