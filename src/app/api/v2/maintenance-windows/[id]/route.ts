import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { internalV2MutationGuard } from '@/lib/api-v2/internal-context';
import {
  assertCanManageMaintenanceServices,
  MaintenanceWindowParams,
  MaintenanceWindowPatchBody,
  projectMaintenanceWindow,
  requireReadableMaintenanceWindow,
} from '@/lib/api-v2/maintenance-windows';
import {
  deleteMaintenanceWindow,
  updateMaintenanceWindow,
} from '@/lib/service-maintenance/windows';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_READ,
  scopedFilter: true,
  paramsSchema: MaintenanceWindowParams,
  querySchema: z.object({}).strict(),
  handler: async ({ actor, params }) => {
    const row = await requireReadableMaintenanceWindow(prisma, actor, params.id);
    return {
      data: projectMaintenanceWindow(row),
      headers: { ...etagHeaders(row.revision), 'Cache-Control': 'no-store' },
    };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_MANAGE,
  paramsSchema: MaintenanceWindowParams,
  querySchema: z.object({}).strict(),
  bodySchema: MaintenanceWindowPatchBody,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, tx, req }) => {
    const existing = await requireReadableMaintenanceWindow(tx!, actor, params.id);
    await assertCanManageMaintenanceServices(tx!, actor, [
      ...existing.services.map(s => s.serviceId),
      ...(body.serviceIds ?? []),
    ]);
    const row = await updateMaintenanceWindow(
      params.id,
      body,
      { id: actor.id, source: 'API' },
      { tx, expectedRevision: requireRevisionIfMatch(req) }
    );
    return {
      data: projectMaintenanceWindow(row),
      headers: { ...etagHeaders(row.revision), 'Cache-Control': 'no-store' },
    };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_MANAGE,
  paramsSchema: MaintenanceWindowParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const existing = await requireReadableMaintenanceWindow(prisma, actor, params.id);
    await assertCanManageMaintenanceServices(
      prisma,
      actor,
      existing.services.map(s => s.serviceId)
    );
    await prisma.$transaction(async tx => {
      // MCP approval recheck inside the delete's own transaction; a no-op for REST callers.
      await internalV2MutationGuard()?.(tx);
      await deleteMaintenanceWindow(params.id, { id: actor.id, source: 'API' }, { tx });
    });
    return { status: 204 };
  },
});
