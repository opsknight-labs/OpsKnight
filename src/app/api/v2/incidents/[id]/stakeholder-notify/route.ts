import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { resolveIncidentResourceForActor } from '@/lib/access/incident-relations';
import {
  notifyIncidentStakeholders,
  NotifyStakeholdersInputSchema,
} from '@/lib/business-services/stakeholder-comms';

/**
 * Sends a stakeholder update (email + in-app, never a page) to followers and subscribed teams
 * of the business services the incident impacts. Rate limited per incident.
 */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_NOTE,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  resourceExtractor: async ({ params, actor }) => {
    const resource = await resolveIncidentResourceForActor(actor, params.id);
    if (!resource) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    return resource;
  },
  bodySchema: NotifyStakeholdersInputSchema,
  idempotent: true,
  handler: async ({ params, body, actor, tx }) => ({
    data: await notifyIncidentStakeholders(
      params.id,
      body,
      { actor, source: 'API' },
      new Date(),
      tx
    ),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
