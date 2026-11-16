import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { objectiveCursor, objectivePagination } from '@/lib/api-v2/service-objectives';
import {
  assertCanManageMaintenanceServices,
  maintenanceWindowReadWhere,
  MaintenanceWindowCreateBody,
  projectMaintenanceWindow,
} from '@/lib/api-v2/maintenance-windows';
import {
  createMaintenanceWindow,
  maintenanceWindowSelect,
} from '@/lib/service-maintenance/windows';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_READ,
  scopedFilter: true,
  querySchema: PaginationQuerySchema.extend({
    serviceId: z.string().cuid().optional(),
    phase: z.enum(['UPCOMING', 'ACTIVE', 'ENDED']).optional(),
  }).strict(),
  handler: async ({ actor, query, pagination }) => {
    const now = new Date();
    const scope = `maintenance:${query.serviceId ?? '*'}:${query.phase ?? '*'}`;
    const boundary = objectiveCursor(pagination.cursor, scope);
    const rows = await prisma.maintenanceWindow.findMany({
      where: {
        AND: [
          maintenanceWindowReadWhere(actor),
          query.serviceId ? { services: { some: { serviceId: query.serviceId } } } : {},
          query.phase === 'UPCOMING' ? { startsAt: { gt: now } } : {},
          query.phase === 'ACTIVE' ? { startsAt: { lte: now }, endsAt: { gt: now } } : {},
          query.phase === 'ENDED' ? { endsAt: { lte: now } } : {},
          boundary
            ? {
                OR: [
                  { startsAt: { lt: boundary.at } },
                  { startsAt: boundary.at, id: { lt: boundary.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: maintenanceWindowSelect,
    });
    const result = objectivePagination(rows, pagination.limit, scope, row => row.startsAt);
    return {
      data: result.data.map(row => projectMaintenanceWindow(row, actor, now)),
      pagination: result.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: MaintenanceWindowCreateBody,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ body, actor, tx }) => {
    await assertCanManageMaintenanceServices(tx!, actor, body.serviceIds);
    const row = await createMaintenanceWindow(body, { id: actor.id, source: 'API' }, { tx });
    return {
      status: 201,
      data: projectMaintenanceWindow(row, actor),
      headers: {
        ...etagHeaders(row.revision),
        'Cache-Control': 'no-store',
        Location: `/api/v2/maintenance-windows/${row.id}`,
      },
    };
  },
});
