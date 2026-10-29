import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { notificationProviderKeySchema } from '@/lib/notifications/provider-schema';
import { requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { fingerprintV2SensitiveValue } from '@/lib/api-v2/auth';
import { queueProviderTestIntent } from '@/lib/provider-test-service';
import prisma from '@/lib/prisma';

const paramsSchema = z.object({ provider: notificationProviderKeySchema });
const bodySchema = z.object({}).strict();

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_TEST,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyPayload: ({ req, params }) => ({
    provider: params.provider,
    testIntent: fingerprintV2SensitiveValue(req, req.headers.get('idempotency-key') ?? ''),
  }),
  rateLimitTier: 'WRITE',
  replayAuthGuard: async context => {
    const user = await prisma.user.findFirst({
      where: { id: context.actor.id, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!user) {
      const { AppError } = await import('@/lib/errors');
      throw new AppError({ code: 'AUTHORIZATION_DENIED' });
    }
  },
  handler: async context => {
    const user = await prisma.user.findFirst({
      where: { id: context.actor.id, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true, email: true, phoneNumber: true, name: true, role: true },
    });
    if (!user) {
      const { AppError } = await import('@/lib/errors');
      throw new AppError({ code: 'AUTHORIZATION_DENIED' });
    }
    const data = await queueProviderTestIntent({
      providerKey: context.params.provider,
      user,
      eventKey: `api-provider-test:${fingerprintV2SensitiveValue(context.req, context.req.headers.get('idempotency-key') ?? '')}`,
      client: context.tx!,
      apiKeyId: context.apiKey.id,
      expectedRevision: requireRevisionIfMatch(context.req),
    });
    return { status: 202, data, headers: { 'Cache-Control': 'no-store' } };
  },
});
