import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  runV2AuditedMutation,
  IntegrationUpdateV2Schema,
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
        revision: true,
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

    return apiV2Success(integration, {
      headers: { ...rlHeaders, ...etagHeaders(integration.revision) },
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
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_MANAGE);

    const { id } = await params;
    const existing = await prisma.integration.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        service: { select: { id: true, teamId: true } },
      },
    });

    if (!existing) {
      throw new AppError({
        code: 'INTEGRATION_NOT_FOUND',
        userMessage: `Integration with id '${id}' was not found.`,
      });
    }

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_MANAGE, {
      type: 'service',
      teamId: existing.service.teamId,
    });

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = IntegrationUpdateV2Schema.parse(body);

    const expected = parseIfMatch(req);

    const updated = await withIfMatch(expected, () =>
      runV2AuditedMutation(
        tx =>
          tx.integration.update({
            where: { id, ...ifMatchWhere(expected) },
            data: {
              ...(validated.name !== undefined ? { name: validated.name } : {}),
              ...(validated.enabled !== undefined ? { enabled: validated.enabled } : {}),
            },
            select: {
              id: true,
              name: true,
              type: true,
              serviceId: true,
              enabled: true,
              createdAt: true,
              updatedAt: true,
              revision: true,
              service: { select: { id: true, name: true } },
            },
          }),
        result => ({
          action: 'integration.updated',
          entityType: 'SERVICE',
          entityId: result.serviceId,
          actorId: actor.id,
          apiKeyId: apiKey.id,
          details: validated,
        })
      )
    );

    return apiV2Success(updated, {
      headers: { ...rlHeaders, ...etagHeaders(updated.revision) },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
