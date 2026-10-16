import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  parsePaginationParams,
  ScheduleOverrideV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { createScheduleOverrideMutation } from '@/lib/schedules/mutations';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';
import { decodeCursor, encodeCursor } from '@/lib/api-v2/pagination';

export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SCHEDULE_READ);

    const { id } = await params;
    const accessWhere = scheduleReadWhere(actor);

    const exists = await prisma.onCallSchedule.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      throw new AppError({
        code: 'SCHEDULE_NOT_FOUND',
        userMessage: `Schedule with id '${id}' was not found.`,
      });
    }

    const schedule = await prisma.onCallSchedule.findFirst({
      where: {
        AND: [{ id }, accessWhere],
      },
      select: { id: true },
    });

    if (!schedule) {
      throw new AppError({
        // Indistinguishable from a missing schedule: do not reveal that it exists.
        code: 'SCHEDULE_NOT_FOUND',
        userMessage: `Schedule with id '${id}' was not found.`,
      });
    }

    // Bounded and cursor-paginated, keeping the established order (latest start first). The signed
    // cursor carries the last row's start time and id, so paging is stable on (start, id).
    const { limit, cursor } = parsePaginationParams(new URL(req.url).searchParams);
    const after = cursor ? decodeCursor(cursor) : null;
    const afterStart = after ? new Date(after.createdAt) : null;
    const overrides = await prisma.onCallOverride.findMany({
      where: {
        AND: [
          { scheduleId: id },
          ...(after && afterStart
            ? [{ OR: [{ start: { lt: afterStart } }, { start: afterStart, id: { lt: after.id } }] }]
            : []),
        ],
      },
      orderBy: [{ start: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        scheduleId: true,
        userId: true,
        replacesUserId: true,
        start: true,
        end: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const hasMore = overrides.length > limit;
    const rows = hasMore ? overrides.slice(0, limit) : overrides;
    const last = rows[rows.length - 1];
    const pagination = {
      limit,
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor({ id: last.id, createdAt: last.start.toISOString() }) : null,
    };
    const dto = rows.map(o => ({
      ...o,
      startDate: o.start,
      endDate: o.end,
    }));

    return apiV2Success(dto, { pagination, headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const POST = withV2Observability(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE);

    const { id } = await params;
    const accessWhere = scheduleReadWhere(actor);

    const schedule = await prisma.onCallSchedule.findFirst({
      where: {
        AND: [{ id }, accessWhere],
      },
      select: { id: true },
    });

    if (!schedule) {
      throw new AppError({
        code: 'SCHEDULE_NOT_FOUND',
        userMessage: `Schedule with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({
        code: 'INVALID_JSON',
        userMessage: 'Invalid JSON request body.',
      });
    });

    const validated = ScheduleOverrideV2Schema.parse(body);

    const created = await createScheduleOverrideMutation(
      {
        scheduleId: id,
        userId: validated.userId,
        replacesUserId: validated.replacesUserId ?? null,
        start: new Date(validated.startDate),
        end: new Date(validated.endDate),
      },
      (tx, override) =>
        logV2Audit({
          action: 'schedule_override.created',
          entityType: 'SCHEDULE',
          entityId: id,
          actorId: actor.id,
          apiKeyId: apiKey.id,
          details: {
            overrideId: override.id,
            userId: override.userId,
            replacesUserId: override.replacesUserId,
            startDate: override.start.toISOString(),
            endDate: override.end.toISOString(),
          },
          tx,
        })
    );

    const dto = {
      ...created,
      startDate: created.start,
      endDate: created.end,
    };

    return apiV2Created(dto, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
