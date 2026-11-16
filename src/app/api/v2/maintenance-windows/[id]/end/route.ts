import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import {
  assertCanManageMaintenanceServices,
  MaintenanceWindowParams,
  projectMaintenanceWindow,
  requireReadableMaintenanceWindow,
} from '@/lib/api-v2/maintenance-windows';
import { endMaintenanceWindowNow } from '@/lib/service-maintenance/windows';

// Not wrapped in the idempotency transaction on purpose: ending is naturally idempotent
// (an ended window is returned unchanged), and running outside a caller transaction lets
// the command release held incidents inline instead of waiting for the scheduler sweep.
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.MAINTENANCE_WINDOW_MANAGE,
  paramsSchema: MaintenanceWindowParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const existing = await requireReadableMaintenanceWindow(prisma, actor, params.id);
    await assertCanManageMaintenanceServices(
      prisma,
      actor,
      existing.services.map(s => s.serviceId)
    );
    const row = await endMaintenanceWindowNow(params.id, { id: actor.id, source: 'API' });
    return {
      data: projectMaintenanceWindow(row),
      headers: { ...etagHeaders(row.revision), 'Cache-Control': 'no-store' },
    };
  },
});
