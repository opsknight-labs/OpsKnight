import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import {
  readRunbookSettings,
  updateRunbookSettings,
  runbookSettingsPatchSchema,
} from '@/lib/runbooks/settings-commands';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SETTINGS_READ,
  querySchema: z.object({}).strict(),
  handler: async () => {
    const data = await readRunbookSettings(prisma);
    return {
      data,
      headers: { ...etagHeaders(data.runbookSettingsRevision), 'Cache-Control': 'no-store' },
    };
  },
});
export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SETTINGS_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: runbookSettingsPatchSchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ req, body, actor, apiKey, tx }) => {
    const data = await updateRunbookSettings(
      body,
      { id: actor.id, apiKeyId: apiKey.id },
      { client: tx, expectedRevision: requireRevisionIfMatch(req) }
    );
    return {
      data,
      headers: { ...etagHeaders(data.runbookSettingsRevision), 'Cache-Control': 'no-store' },
    };
  },
});
