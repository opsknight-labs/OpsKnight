import { randomBytes } from 'node:crypto';
import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { IntegrationCreateV2Schema } from '@/lib/api-v2/validation';
import { AppError } from '@/lib/errors';
import { logV2Audit } from '@/lib/api-v2/audit';
import { encrypt } from '@/lib/encryption';
import { integrationKeyFingerprint } from '@/lib/integrations/credentials';

const paramsSchema = z.object({ id: z.string().min(1) });
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INTEGRATION_CREATE,
  paramsSchema,
  bodySchema: IntegrationCreateV2Schema,
  idempotent: true,
  idempotencyRequired: true,
  persistIdempotencyResult: result => {
    if (result instanceof Response || !result.data || typeof result.data !== 'object')
      throw new Error('Expected integration creation result');
    return { ...result, data: { ...(result.data as object), key: null } };
  },
  replayAuthGuard: async ({ params, actor, tx }) => {
    const service = await tx!.service.findUnique({
      where: { id: params.id },
      select: { teamId: true },
    });
    if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    const admin = await tx!.user.findFirst({
      where: { id: actor.id, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!admin) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  },
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const admin = await tx!.user.findFirst({
      where: { id: actor.id, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!admin) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
    const service = await tx!.service.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    if (body.type === 'CLOUDWATCH' && !body.snsTopicArn)
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'CloudWatch requires an SNS topic ARN.',
      });
    const key = randomBytes(32).toString('base64url');
    const integration = await tx!.integration.create({
      data: {
        name: body.name,
        type: body.type,
        serviceId: service.id,
        key: await encrypt(key),
        keyFingerprint: integrationKeyFingerprint(key),
        snsTopicArn: body.type === 'CLOUDWATCH' ? body.snsTopicArn : null,
      },
      select: {
        id: true,
        name: true,
        type: true,
        serviceId: true,
        enabled: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await logV2Audit({
      action: 'integration.created',
      entityType: 'SERVICE',
      entityId: service.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { integrationId: integration.id, name: body.name, type: body.type },
      tx,
    });
    return {
      status: 201,
      data: { ...integration, key },
      headers: { 'Cache-Control': 'no-store', Location: `/api/v2/integrations/${integration.id}` },
    };
  },
});
