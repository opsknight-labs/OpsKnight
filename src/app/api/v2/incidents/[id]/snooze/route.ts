import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  IncidentLifecycleV2Schema,
  applyV2IncidentLifecycle,
} from '@/lib/api-v2/incident-lifecycle';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: IncidentLifecycleV2Schema.extend({
    snoozedUntil: z.string().datetime({ offset: true }),
  }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async context => ({ data: await applyV2IncidentLifecycle(context, 'SNOOZE') }),
});
