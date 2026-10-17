import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { getAutomationSettings } from '@/lib/automation/settings';
import {
  automationSettingsSchema,
  updateAutomationSettings,
} from '@/lib/automation/settings-command';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_SETTINGS_READ,
  querySchema: z.object({}).strict(),
  handler: async () => {
    const data = await getAutomationSettings();
    return {
      data,
      headers: { ...etagHeaders(data.automationSettingsRevision), 'Cache-Control': 'no-store' },
    };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_SETTINGS_WRITE,
  querySchema: z.object({}).strict(),
  bodySchema: automationSettingsSchema.omit({ expectedRevision: true }),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ req, body, actor, apiKey, tx }) => {
    const data = await updateAutomationSettings(
      { ...body, expectedRevision: requireRevisionIfMatch(req) },
      { actorId: actor.id, source: 'API', apiClientId: apiKey.id },
      tx
    );
    return {
      data,
      headers: { ...etagHeaders(data.automationSettingsRevision), 'Cache-Control': 'no-store' },
    };
  },
});
