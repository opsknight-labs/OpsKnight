import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  IntegrationUpdateV2Schema,
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_READ);

    const { id } = await params;
    const integration = await prisma.integration.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        serviceId: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        service: {
          select: { id: true, name: true, teamId: true },
        },
      },
    });

    if (!integration) {
      throw new AppError({
        code: 'INTEGRATION_NOT_FOUND',
        userMessage: `Integration with id '${id}' was not found.`,
      });
    }

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_READ, {
      type: 'service',
      teamId: integration.service.teamId,
    });

    return apiV2Success(integration, { headers: rlHeaders });
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_MANAGE);

    const { id } = await params;
    const existing = await prisma.integration.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!existing) {
      throw new AppError({
        code: 'INTEGRATION_NOT_FOUND',
        userMessage: `Integration with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = IntegrationUpdateV2Schema.parse(body);

    const updated = await prisma.integration.update({
      where: { id },
      data: {
        name: validated.name,
      },
      select: {
        id: true,
        name: true,
        type: true,
        serviceId: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        service: { select: { id: true, name: true } },
      },
    });

    await logV2Audit({
      action: 'integration.updated',
      entityType: 'SERVICE',
      entityId: updated.serviceId,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: validated,
    });

    return apiV2Success(updated, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
