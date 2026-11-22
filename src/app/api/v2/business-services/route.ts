import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { listBusinessServices } from '@/lib/business-services/contract';
import {
  BUSINESS_SERVICE_SELECT,
  BusinessServiceInputSchema,
  businessServiceDto,
  createBusinessService,
  healthIncidentIds,
} from '@/lib/business-services/commands';
import { readableIncidentIds } from '@/lib/business-services/stats';

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .trim()
    .max(200)
    .transform(value =>
      value
        .split(',')
        .map(part => part.trim().toUpperCase())
        .filter(Boolean)
    )
    .pipe(z.array(z.enum(values)).min(1).max(values.length));

const ListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  tier: csv(['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3']).optional(),
  status: csv([
    'OPERATIONAL',
    'DEGRADED',
    'PARTIAL_OUTAGE',
    'MAJOR_OUTAGE',
    'MAINTENANCE',
    'UNKNOWN',
  ]).optional(),
  ownerTeamId: z.string().trim().min(1).max(100).optional(),
  impactedOnly: z
    .enum(['true', 'false'])
    .transform(value => value === 'true')
    .optional(),
  /** newest (default, unchanged order) or name. */
  sort: z.enum(['newest', 'name']).default('newest'),
}).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  // The handler filters to the actor's business services (businessServiceReadWhere).
  scopedFilter: true,
  paramsSchema: z.object({}).strict(),
  querySchema: ListQuerySchema,
  handler: async ({ actor, pagination, query }) => {
    const page = await listBusinessServices(
      {
        filter: {
          query: query.q,
          criticality: query.tier,
          status: query.status,
          ownerTeamId: query.ownerTeamId,
          impactedOnly: query.impactedOnly,
        },
        sort: query.sort,
        cursor: pagination.cursor,
        limit: pagination.limit,
      },
      actor
    );
    const rows = page.items.length
      ? await prisma.businessService.findMany({
          where: { id: { in: page.items.map(item => item.id) } },
          select: BUSINESS_SERVICE_SELECT,
        })
      : [];
    const byId = new Map(rows.map(row => [row.id, row]));
    const readable = await readableIncidentIds(
      actor,
      healthIncidentIds(page.items.map(item => item.health))
    );
    return {
      data: page.items.flatMap(item => {
        const row = byId.get(item.id);
        return row ? [businessServiceDto(row, item.health, readable)] : [];
      }),
      pagination: {
        limit: pagination.limit,
        nextCursor: page.nextCursor,
        hasMore: page.nextCursor !== null,
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema: z.object({}).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: BusinessServiceInputSchema,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ body, actor, apiKey, tx }) => {
    const created = await createBusinessService(body, { actor, source: 'API' }, tx);
    await logV2Audit({
      action: 'business_service.created',
      entityType: 'BUSINESS_SERVICE',
      entityId: created.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { name: created.name },
      tx,
    });
    return { status: 201, data: businessServiceDto(created) };
  },
});
