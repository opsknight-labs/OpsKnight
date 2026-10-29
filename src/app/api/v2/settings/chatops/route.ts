import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import {
  chatOpsConfigSchema,
  getChatOpsConfiguration,
  saveChatOpsConfiguration,
} from '@/lib/chatops/config-command';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.CHATOPS_READ,
  querySchema: z.object({}).strict(),
  handler: async () => {
    const result = await getChatOpsConfiguration(prisma);
    return {
      data: result,
      headers: { ...etagHeaders(result.revision), 'Cache-Control': 'private, no-store' },
    };
  },
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.CHATOPS_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: chatOpsConfigSchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ req, body, actor, apiKey, tx }) => {
    const result = await saveChatOpsConfiguration(
      body,
      { revision: requireRevisionIfMatch(req) },
      { id: actor.id, source: 'API', apiClientId: apiKey.id },
      tx!
    );
    return {
      data: result,
      headers: { ...etagHeaders(result.revision), 'Cache-Control': 'private, no-store' },
    };
  },
});
