import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { internalV2MutationGuard } from '@/lib/api-v2/internal-context';
import {
  assertCanManageMaintenanceServices,
  MaintenanceSchedulePatchBody,
  MaintenanceWindowParams,
  projectMaintenanceSchedule,
  requireReadableMaintenanceSchedule,
} from '@/lib/api-v2/maintenance-windows';
import {
  deleteMaintenanceSchedule,
  MAINTENANCE_SCHEDULE_LIMITS,
  updateMaintenanceSchedule,
} from '@/lib/service-maintenance/schedules';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_READ,
  scopedFilter: true,
  paramsSchema: MaintenanceWindowParams,
  querySchema: z.object({}).strict(),
  handler: async ({ actor, params }) => {
    const row = await requireReadableMaintenanceSchedule(prisma, actor, params.id);
    return {
      data: projectMaintenanceSchedule(row, actor),
      headers: { ...etagHeaders(row.revision), 'Cache-Control': 'no-store' },
    };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_MANAGE,
  paramsSchema: MaintenanceWindowParams,
  querySchema: z.object({}).strict(),
  bodySchema: MaintenanceSchedulePatchBody,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, tx, req }) => {
    const existing = await requireReadableMaintenanceSchedule(tx!, actor, params.id);
    await assertCanManageMaintenanceServices(tx!, actor, [
      ...existing.services.map(s => s.serviceId),
      ...(body.serviceIds ?? []),
    ]);
    const row = await updateMaintenanceSchedule(
      params.id,
      body,
      { id: actor.id, source: 'API' },
      { tx, expectedRevision: requireRevisionIfMatch(req) }
    );
    return {
      data: projectMaintenanceSchedule(row, actor),
      headers: { ...etagHeaders(row.revision), 'Cache-Control': 'no-store' },
    };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_MANAGE,
  paramsSchema: MaintenanceWindowParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const existing = await requireReadableMaintenanceSchedule(prisma, actor, params.id);
    await assertCanManageMaintenanceServices(
      prisma,
      actor,
      existing.services.map(s => s.serviceId)
    );
    await prisma.$transaction(
      async tx => {
        // MCP approval recheck inside the delete's own transaction; a no-op for REST callers.
        await internalV2MutationGuard()?.(tx);
        await deleteMaintenanceSchedule(params.id, { id: actor.id, source: 'API' }, { tx });
      },
      { timeout: MAINTENANCE_SCHEDULE_LIMITS.transactionTimeoutMs }
    );
    return { status: 204 };
  },
});
