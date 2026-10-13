import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  ServiceUpdateV2Schema,
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_READ);

    const { id } = await params;
    const service = await prisma.service.findUnique({
      where: { id },
      include: {
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

    if (!service) {
      throw new AppError({
        code: 'SERVICE_NOT_FOUND',
        status: 404,
        userMessage: `Service with id '${id}' was not found.`,
      });
    }

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_READ, {
      type: 'service',
      teamId: service.teamId,
    });

    const dto = {
      id: service.id,
      name: service.name,
      description: service.description,
      status: service.status,
      teamId: service.teamId,
      team: service.team,
      escalationPolicyId: service.escalationPolicyId,
      escalationPolicy: service.escalationPolicy,
      openIncidentsCount: service._count.incidents,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_UPDATE);

    const { id } = await params;
    const existing = await prisma.service.findUnique({
      where: { id },
      select: { id: true, teamId: true },
    });

    if (!existing) {
      throw new AppError({
        code: 'SERVICE_NOT_FOUND',
        status: 404,
        userMessage: `Service with id '${id}' was not found.`,
      });
    }

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_UPDATE, {
      type: 'service',
      teamId: existing.teamId,
    });

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', status: 400, userMessage: 'Invalid JSON request body.' });
    });

    const validated = ServiceUpdateV2Schema.parse(body);

    if (validated.teamId) {
      const team = await prisma.team.findUnique({
        where: { id: validated.teamId },
        select: { id: true },
      });
      if (!team) {
        throw new AppError({
          code: 'TEAM_NOT_FOUND',
          status: 404,
          userMessage: `Team with id '${validated.teamId}' not found.`,
        });
      }
    }

    if (validated.escalationPolicyId) {
      const policy = await prisma.escalationPolicy.findUnique({
        where: { id: validated.escalationPolicyId },
        select: { id: true },
      });
      if (!policy) {
        throw new AppError({
          code: 'ESCALATION_POLICY_NOT_FOUND',
          status: 404,
          userMessage: `Escalation policy with id '${validated.escalationPolicyId}' not found.`,
        });
      }
    }

    const updated = await prisma.service.update({
      where: { id },
      data: {
        name: validated.name,
        description: validated.description,
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
      action: 'service.updated',
      entityType: 'SERVICE',
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_DELETE);

    const { id } = await params;
    const service = await prisma.service.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            incidents: {
              where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
            },
          },
        },
      },
    });

    if (!service) {
      throw new AppError({
        code: 'SERVICE_NOT_FOUND',
        status: 404,
        userMessage: `Service with id '${id}' was not found.`,
      });
    }

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_DELETE, {
      type: 'service',
      teamId: service.teamId,
    });

    if (service._count.incidents > 0) {
      throw new AppError({
        code: 'SERVICE_HAS_ACTIVE_INCIDENTS',
        status: 409,
        userMessage: `Cannot delete service '${service.name}' because it has ${service._count.incidents} active open incident(s). Resolve all open incidents first.`,
      });
    }

    await prisma.service.delete({ where: { id } });

    await logV2Audit({
      action: 'service.deleted',
      entityType: 'SERVICE',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { name: service.name, teamId: service.teamId },
    });

    return apiV2Success({ success: true, message: `Service '${service.name}' deleted successfully.` }, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
