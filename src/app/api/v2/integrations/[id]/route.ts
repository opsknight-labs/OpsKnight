import { NextRequest } from 'next/server';
import { internalV2MutationGuard } from '@/lib/api-v2/internal-context';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  IntegrationUpdateV2Schema,
  defineV2Route,
} from '@/lib/api-v2';
import { etagHeaders, ifMatchWhere, parseIfMatch, withIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { logV2Audit } from '@/lib/api-v2/audit';
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
        snsTopicArn: true,
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
        type: true,
        snsTopicArn: true,
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
    if (validated.snsTopicArn && existing.type !== 'CLOUDWATCH')
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'SNS topic configuration is only supported for CloudWatch integrations.',
      });

    const expected = parseIfMatch(req);

    const updated = await withIfMatch(expected, async () => {
      const updated = await prisma.$transaction(
        async tx => {
          // MCP approval recheck inside the change's own transaction; a no-op for REST callers.
          await internalV2MutationGuard()?.(tx);
          const current = await tx.integration.findUnique({
            where: { id },
            select: { revision: true, type: true, snsTopicArn: true },
          });
          if (!current || (expected !== null && current.revision !== expected)) {
            throw new AppError({
              code: 'PRECONDITION_FAILED',
              userMessage: 'Integration changed. Fetch the latest resource and retry.',
            });
          }
          const snsTopicArn = validated.snsTopicArn ?? current.snsTopicArn;
          if (
            validated.enabled === true &&
            current.type === 'CLOUDWATCH' &&
            (!snsTopicArn ||
              !/^arn:(aws|aws-us-gov|aws-cn):sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(
                snsTopicArn
              ))
          ) {
            throw new AppError({
              code: 'VALIDATION_FAILED',
              userMessage:
                'CloudWatch integration requires a valid SNS topic before it can be enabled.',
            });
          }
          const result = await tx.integration.update({
            where: { id, ...ifMatchWhere(expected) },
            data: {
              ...(validated.name !== undefined ? { name: validated.name } : {}),
              ...(validated.enabled !== undefined ? { enabled: validated.enabled } : {}),
              ...(validated.snsTopicArn !== undefined
                ? { snsTopicArn: validated.snsTopicArn }
                : {}),
            },
            select: {
              id: true,
              name: true,
              type: true,
              serviceId: true,
              enabled: true,
              snsTopicArn: true,
              createdAt: true,
              updatedAt: true,
              revision: true,
              service: { select: { id: true, name: true } },
            },
          });
          await logV2Audit({
            action: 'integration.updated',
            entityType: 'SERVICE',
            entityId: result.serviceId,
            actorId: actor.id,
            apiKeyId: apiKey.id,
            details: { integrationId: id, ...validated },
            tx,
          });
          return result;
        },
        { isolationLevel: 'Serializable' }
      );
      return updated;
    });

    return apiV2Success(updated, {
      headers: { ...rlHeaders, ...etagHeaders(updated.revision) },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INTEGRATION_DELETE,
  paramsSchema: z.object({ id: z.string().min(1) }),
  querySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ actor, tx }) => {
    const admin = await tx!.user.findFirst({
      where: { id: actor.id, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!admin) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  },
  handler: async ({ params, req, actor, apiKey, tx }) => {
    const row = await tx!.integration.findUnique({
      where: { id: params.id },
      select: { id: true, serviceId: true, revision: true },
    });
    if (!row) throw new AppError({ code: 'INTEGRATION_NOT_FOUND' });
    if (row.revision !== parseIfMatch(req)) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const admin = await tx!.user.findFirst({
      where: { id: actor.id, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!admin) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
    const activeDeliveries = await tx!.inboundDelivery.count({
      where: { integrationId: row.id, status: 'PROCESSING' },
    });
    if (activeDeliveries > 0)
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'Integration has inbound deliveries in progress. Retry after they finish.',
      });
    const deletedDeliveryHistory = await tx!.inboundDelivery.deleteMany({
      where: { integrationId: row.id },
    });
    await tx!.integration.delete({ where: { id: row.id } });
    await logV2Audit({
      action: 'integration.deleted',
      entityType: 'SERVICE',
      entityId: row.serviceId,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { integrationId: row.id, deletedDeliveryHistoryCount: deletedDeliveryHistory.count },
      tx,
    });
    return { status: 204, data: undefined };
  },
});
