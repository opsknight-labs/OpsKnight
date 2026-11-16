import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { objectiveCursor, objectivePagination } from '@/lib/api-v2/service-objectives';
import {
  assertCanManageMaintenanceServices,
  maintenanceScheduleReadWhere,
  MaintenanceScheduleCreateBody,
  projectMaintenanceSchedule,
} from '@/lib/api-v2/maintenance-windows';
import {
  createMaintenanceSchedule,
  maintenanceScheduleSelect,
} from '@/lib/service-maintenance/schedules';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_READ,
  scopedFilter: true,
  querySchema: PaginationQuerySchema.extend({
    serviceId: z.string().cuid().optional(),
  }).strict(),
  handler: async ({ actor, query, pagination }) => {
    const now = new Date();
    const scope = `maintenance-schedules:${query.serviceId ?? '*'}`;
    const boundary = objectiveCursor(pagination.cursor, scope);
    const rows = await prisma.maintenanceSchedule.findMany({
      where: {
        AND: [
          maintenanceScheduleReadWhere(actor),
          query.serviceId ? { services: { some: { serviceId: query.serviceId } } } : {},
          boundary
            ? {
                OR: [
                  { createdAt: { lt: boundary.at } },
                  { createdAt: boundary.at, id: { lt: boundary.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: maintenanceScheduleSelect,
    });
    const result = objectivePagination(rows, pagination.limit, scope, row => row.createdAt);
    return {
      data: result.data.map(row => projectMaintenanceSchedule(row, actor, now)),
      pagination: result.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: MaintenanceScheduleCreateBody,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ body, actor, tx }) => {
    await assertCanManageMaintenanceServices(tx!, actor, body.serviceIds);
    const row = await createMaintenanceSchedule(body, { id: actor.id, source: 'API' }, { tx });
    return {
      status: 201,
      data: projectMaintenanceSchedule(row, actor),
      headers: {
        ...etagHeaders(row.revision),
        'Cache-Control': 'no-store',
        Location: `/api/v2/maintenance-schedules/${row.id}`,
      },
    };
  },
});
