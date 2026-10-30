import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, parseIfMatch } from '@/lib/api-v2/concurrency';
import { fingerprintV2SensitiveValue } from '@/lib/api-v2/auth';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import {
  notificationProviderConfigurationInput,
  notificationProviderKeySchema,
} from '@/lib/notifications/provider-schema';
import { readNotificationProvider, saveNotificationProvider } from '@/lib/notifications/providers';

const paramsSchema = z.object({ provider: notificationProviderKeySchema });
const bodySchema = notificationProviderConfigurationInput();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_READ,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async context => {
    const data = await readNotificationProvider(context.params.provider);
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyPayload: ({ req, body }) => ({
    provider: body.provider,
    enabled: body.enabled,
    ifMatch: req.headers.get('if-match'),
    secretFingerprint: fingerprintV2SensitiveValue(req, JSON.stringify(body.config)),
  }),
  replayAuthGuard: async context => {
    const admin = await prisma.user.findFirst({
      where: { id: context.actor.id, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!admin) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  },
  handler: async context => {
    if (context.body.provider !== context.params.provider) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Provider in the path must match provider in the request body.',
      });
    }
    if (context.req.headers.get('if-match')?.trim() === '*') {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'If-Match must contain a concrete provider revision.',
      });
    }
    const data = await saveNotificationProvider({
      provider: context.params.provider,
      enabled: context.body.enabled,
      config: context.body.config,
      actorId: context.actor.id,
      actorApiKeyId: context.apiKey.id,
      expectedRevision: parseIfMatch(context.req),
      client: context.tx,
    });
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});
