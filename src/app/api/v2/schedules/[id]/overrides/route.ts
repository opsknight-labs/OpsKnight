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
    const schedule = await prisma.onCallSchedule.findUnique({ where: { id } });
    if (!schedule) {
      throw new AppError({
        code: 'SCHEDULE_NOT_FOUND',
        status: 404,
        userMessage: `Schedule with id '${id}' was not found.`,
      });
    }

    const overrides = await prisma.onCallOverride.findMany({
      where: { scheduleId: id },
      orderBy: { startDate: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return apiV2Success(overrides, { headers: rlHeaders });
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
    const schedule = await prisma.onCallSchedule.findUnique({ where: { id } });
    if (!schedule) {
      throw new AppError({
        code: 'SCHEDULE_NOT_FOUND',
        status: 404,
        userMessage: `Schedule with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', status: 400, userMessage: 'Invalid JSON request body.' });
    });

    const validated = ScheduleOverrideV2Schema.parse(body);

    const start = new Date(validated.startDate);
    const end = new Date(validated.endDate);

    if (end <= start) {
      throw new AppError({
        code: 'INVALID_TIME_RANGE',
        status: 400,
        userMessage: 'Override end date must be strictly after start date.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: validated.userId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        status: 400,
        userMessage: `Override user with id '${validated.userId}' is invalid or inactive.`,
      });
    }

    const created = await prisma.onCallOverride.create({
      data: {
        scheduleId: id,
        userId: validated.userId,
        startDate: start,
        endDate: end,
        replacesUserId: validated.replacesUserId ?? null,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
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
        startDate: created.startDate.toISOString(),
        endDate: created.endDate.toISOString(),
      },
    });

    return apiV2Created(created, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
