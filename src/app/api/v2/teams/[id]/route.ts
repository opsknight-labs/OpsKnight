import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  runV2AuditedMutation,
  TeamUpdateV2Schema,
} from '@/lib/api-v2';
import { etagHeaders, ifMatchWhere, parseIfMatch, withIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(
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

    return apiV2Success(dto, {
      headers: { ...rlHeaders, ...etagHeaders(team.updatedAt) },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const PATCH = withV2Observability(async function PATCH(
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
        userMessage: `Team with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = TeamUpdateV2Schema.parse(body);

    const expected = parseIfMatch(req);

    const updated = await withIfMatch(expected, () =>
      runV2AuditedMutation(
        tx =>
          tx.team.update({
            where: { id, ...ifMatchWhere(expected) },
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
          }),
        () => ({
          action: 'team.updated',
          entityType: 'TEAM',
          entityId: id,
          actorId: actor.id,
          apiKeyId: apiKey.id,
          details: validated,
        })
      )
    );

    return apiV2Success(updated, {
      headers: { ...rlHeaders, ...etagHeaders(updated.updatedAt) },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const DELETE = withV2Observability(async function DELETE(
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
        userMessage: `Team with id '${id}' was not found.`,
      });
    }

    if (team._count.services > 0) {
      throw new AppError({
        code: 'TEAM_HAS_SERVICES',
        userMessage: `Cannot delete team '${team.name}' because ${team._count.services} service(s) are assigned to it. Reassign those services first.`,
      });
    }

    await prisma.$transaction(async tx => {
      await tx.teamMember.deleteMany({ where: { teamId: id } });
      await tx.team.delete({ where: { id } });
      await logV2Audit({
        action: 'team.deleted',
        entityType: 'TEAM',
        entityId: id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { name: team.name },
        tx,
      });
    });

    return apiV2Success(
      { success: true, message: `Team '${team.name}' deleted successfully.` },
      { headers: rlHeaders }
    );
  } catch (error) {
    return apiV2Error(error, req);
  }
});
