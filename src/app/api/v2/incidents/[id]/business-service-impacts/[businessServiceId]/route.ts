import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS, type AuthorizationActor } from '@/lib/authorization-policy';
import type { Prisma } from '@prisma/client';
import { setIncidentImpactCommand } from '@/lib/business-services/impacts';

const paramsSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    businessServiceId: z.string().trim().min(1).max(100),
  })
  .strict();

async function change(
  params: z.infer<typeof paramsSchema>,
  impacted: boolean,
  actor: AuthorizationActor,
  tx?: Prisma.TransactionClient
) {
  const { changed } = await setIncidentImpactCommand(
    { incidentId: params.id, businessServiceId: params.businessServiceId, impacted },
    actor,
    'API',
    tx
  );
  return {
    data: { incidentId: params.id, businessServiceId: params.businessServiceId, impacted, changed },
  };
}

/** Marks the incident as impacting the business service (MANUAL), even below its threshold. */
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: ({ params, actor, tx }) => change(params, true, actor, tx),
});

/** Unmarks it; the exclusion is remembered so automatic impact never re-adds it. */
export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: ({ params, actor, tx }) => change(params, false, actor, tx),
});
