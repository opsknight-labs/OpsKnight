import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { resolveEscalationTarget } from '@/lib/escalation';
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
    const schedule = await prisma.onCallSchedule.findUnique({
      where: { id },
      select: { id: true, name: true, timeZone: true },
    });

    if (!schedule) {
      throw new AppError({
        code: 'SCHEDULE_NOT_FOUND',
        userMessage: `Schedule with id '${id}' was not found.`,
      });
    }

    const accessible = await prisma.onCallSchedule.findFirst({
      where: {
        AND: [
          { id },
          scheduleReadWhere(actor),
        ],
      },
      select: { id: true },
    });

    if (!accessible) {
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'You are not authorized to view this schedule.',
      });
    }

    const { searchParams } = new URL(req.url);
    const atParam = searchParams.get('at');
    const atTime = atParam ? new Date(atParam) : new Date();

    if (Number.isNaN(atTime.getTime())) {
      throw new AppError({
        code: 'INVALID_TIMESTAMP',
        userMessage: "Invalid 'at' timestamp query parameter. Provide a valid ISO 8601 date string.",
      });
    }

    const userIds = await resolveEscalationTarget('SCHEDULE', id, atTime);

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        timeZone: true,
      },
    });

    const result = {
      schedule: {
        id: schedule.id,
        name: schedule.name,
        timeZone: schedule.timeZone,
      },
      at: atTime.toISOString(),
      onCallUsers: users,
    };

    return apiV2Success(result, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
