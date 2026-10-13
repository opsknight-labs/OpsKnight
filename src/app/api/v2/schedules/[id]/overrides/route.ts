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
  ScheduleOverrideV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { createScheduleOverrideMutation } from '@/lib/schedules/mutations';
import { AppError } from '@/lib/errors';

export async function GET(
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
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'You are not authorized to access this schedule.',
      });
    }

    const overrides = await prisma.onCallOverride.findMany({
      where: { scheduleId: id },
      orderBy: { start: 'desc' },
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

    const dto = overrides.map(o => ({
      ...o,
      startDate: o.start,
      endDate: o.end,
    }));

    return apiV2Success(dto, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function POST(
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

    const created = await createScheduleOverrideMutation({
      scheduleId: id,
      userId: validated.userId,
      replacesUserId: validated.replacesUserId ?? null,
      start: new Date(validated.startDate),
      end: new Date(validated.endDate),
    });

    await logV2Audit({
      action: 'schedule_override.created',
      entityType: 'SCHEDULE',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: {
        overrideId: created.id,
        userId: created.userId,
        replacesUserId: created.replacesUserId,
        startDate: created.start.toISOString(),
        endDate: created.end.toISOString(),
      },
    });

    const dto = {
      ...created,
      startDate: created.start,
      endDate: created.end,
    };

    return apiV2Created(dto, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
