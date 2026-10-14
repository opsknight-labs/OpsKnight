import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  ScheduleUpdateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
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
      include: {
        layers: {
          orderBy: { priority: 'asc' },
          include: {
            users: {
              orderBy: { position: 'asc' },
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
          },
        },
      },
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
        userMessage: 'You are not authorized to access this schedule.',
      });
    }

    return apiV2Success(schedule, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE);

    const { id } = await params;
    const existing = await prisma.onCallSchedule.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError({
        code: 'SCHEDULE_NOT_FOUND',
        userMessage: `Schedule with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = ScheduleUpdateV2Schema.parse(body);

    const updated = await prisma.onCallSchedule.update({
      where: { id },
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
    });

    await logV2Audit({
      action: 'schedule.updated',
      entityType: 'SCHEDULE',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: validated,
    });

    return apiV2Success(updated, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function DELETE(
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
        userMessage: `Schedule with id '${id}' was not found.`,
      });
    }

    // Dependency check: verify no escalation rule targets this schedule
    const rulesUsingSchedule = await prisma.escalationRule.findMany({
      where: { targetType: 'SCHEDULE', targetScheduleId: id },
      select: { id: true, policy: { select: { id: true, name: true } } },
    });

    if (rulesUsingSchedule.length > 0) {
      const policyNames = [...new Set(rulesUsingSchedule.map(r => r.policy.name))].join(', ');
      throw new AppError({
        code: 'SCHEDULE_IN_USE',
        userMessage: `Cannot delete schedule '${schedule.name}' because it is referenced in escalation policy (${policyNames}). Reassign or remove this schedule target first.`,
      });
    }

    await prisma.$transaction(async tx => {
      await tx.onCallOverride.deleteMany({ where: { scheduleId: id } });
      await tx.onCallLayerUser.deleteMany({ where: { layer: { scheduleId: id } } });
      await tx.onCallLayer.deleteMany({ where: { scheduleId: id } });
      await tx.onCallSchedule.delete({ where: { id } });
      await logV2Audit({
        action: 'schedule.deleted',
        entityType: 'SCHEDULE',
        entityId: id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { name: schedule.name },
        tx,
      });
    });

    return apiV2Success({ success: true, message: `Schedule '${schedule.name}' deleted successfully.` }, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
