import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  TeamUpdateV2Schema,
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.TEAM_READ);

    const { id } = await params;
    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        },
        services: {
          select: { id: true, name: true, status: true },
        },
      },
    });

    if (!team) {
      throw new AppError({
        code: 'TEAM_NOT_FOUND',
        status: 404,
        userMessage: `Team with id '${id}' was not found.`,
      });
    }

    const dto = {
      id: team.id,
      name: team.name,
      description: team.description,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      members: team.members.map(m => ({
        id: m.id,
        role: m.role,
        user: m.user,
      })),
      services: team.services,
    };

    return apiV2Success(dto, { headers: rlHeaders });
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.TEAM_MANAGE);

    const { id } = await params;
    const existing = await prisma.team.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError({
        code: 'TEAM_NOT_FOUND',
        status: 404,
        userMessage: `Team with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', status: 400, userMessage: 'Invalid JSON request body.' });
    });

    const validated = TeamUpdateV2Schema.parse(body);

    const updated = await prisma.team.update({
      where: { id },
      data: {
        name: validated.name,
        description: validated.description,
      },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logV2Audit({
      action: 'team.updated',
      entityType: 'TEAM',
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.TEAM_MANAGE);

    const { id } = await params;
    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        _count: { select: { services: true } },
      },
    });

    if (!team) {
      throw new AppError({
        code: 'TEAM_NOT_FOUND',
        status: 404,
        userMessage: `Team with id '${id}' was not found.`,
      });
    }

    if (team._count.services > 0) {
      throw new AppError({
        code: 'TEAM_HAS_SERVICES',
        status: 409,
        userMessage: `Cannot delete team '${team.name}' because ${team._count.services} service(s) are assigned to it. Reassign those services first.`,
      });
    }

    await prisma.$transaction(async tx => {
      await tx.teamMember.deleteMany({ where: { teamId: id } });
      await tx.team.delete({ where: { id } });
    });

    await logV2Audit({
      action: 'team.deleted',
      entityType: 'TEAM',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { name: team.name },
    });

    return apiV2Success({ success: true, message: `Team '${team.name}' deleted successfully.` }, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
