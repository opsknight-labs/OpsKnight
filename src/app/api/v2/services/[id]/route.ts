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
  ServiceUpdateV2Schema,
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_READ);

    const { id } = await params;
    const service = await prisma.service.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        policy: { select: { id: true, name: true } },
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
      escalationPolicy: service.policy,
      openIncidentsCount: service._count.incidents,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    };

    return apiV2Success(dto, {
      headers: { ...rlHeaders, ...etagHeaders(service.updatedAt) },
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_UPDATE);

    const { id } = await params;
    const existing = await prisma.service.findUnique({
      where: { id },
      select: { id: true, teamId: true },
    });

    if (!existing) {
      throw new AppError({
        code: 'SERVICE_NOT_FOUND',
        userMessage: `Service with id '${id}' was not found.`,
      });
    }

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_UPDATE, {
      type: 'service',
      teamId: existing.teamId,
    });

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
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
          userMessage: `Escalation policy with id '${validated.escalationPolicyId}' not found.`,
        });
      }
    }

    const expected = parseIfMatch(req);

    const updated = await withIfMatch(expected, () =>
      runV2AuditedMutation(
        tx =>
          tx.service.update({
            where: { id, ...ifMatchWhere(expected) },
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
              policy: { select: { id: true, name: true } },
            },
          }),
        () => ({
          action: 'service.updated',
          entityType: 'SERVICE',
          entityId: id,
          actorId: actor.id,
          apiKeyId: apiKey.id,
          details: validated,
        })
      )
    );

    const dto = {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      status: updated.status,
      teamId: updated.teamId,
      escalationPolicyId: updated.escalationPolicyId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      team: updated.team,
      escalationPolicy: updated.policy,
    };

    return apiV2Success(dto, {
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_DELETE);

    const { id } = await params;
    const service = await prisma.service.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        teamId: true,
      },
    });

    if (!service) {
      throw new AppError({
        code: 'SERVICE_NOT_FOUND',
        userMessage: `Service with id '${id}' was not found.`,
      });
    }

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_DELETE, {
      type: 'service',
      teamId: service.teamId,
    });

    // Invariant 1: Incident history is an audit record and must never be erased.
    // Preserves foreign key RESTRICT constraint and domain safety.
    const incidentCount = await prisma.incident.count({ where: { serviceId: id } });
    if (incidentCount > 0) {
      throw new AppError({
        code: 'SERVICE_HAS_ACTIVE_INCIDENTS',
        userMessage: `Cannot delete service '${service.name}' while it has ${incidentCount} incident(s). Preserve or reassign the incident history first.`,
      });
    }

    // Invariant 2: Service objectives and reliability history must retain original scope.
    const objectiveCount = await prisma.serviceObjective.count({ where: { serviceId: id } });
    if (objectiveCount > 0) {
      throw new AppError({
        code: 'SERVICE_HAS_ACTIVE_INCIDENTS',
        userMessage: `Cannot delete service '${service.name}' while it has ${objectiveCount} service objective revision(s). Reliability history must retain its original service scope.`,
      });
    }

    await prisma.$transaction(async tx => {
      await tx.service.delete({ where: { id } });
      await logV2Audit({
        action: 'service.deleted',
        entityType: 'SERVICE',
        entityId: id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { name: service.name, teamId: service.teamId },
        tx,
      });
    });

    return apiV2Success(
      { success: true, message: `Service '${service.name}' deleted successfully.` },
      { headers: rlHeaders }
    );
  } catch (error) {
    return apiV2Error(error, req);
  }
});
