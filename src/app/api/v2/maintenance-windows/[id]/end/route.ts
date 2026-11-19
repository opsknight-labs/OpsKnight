import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { internalV2MutationGuard } from '@/lib/api-v2/internal-context';
import { logger } from '@/lib/logger';
import {
  assertCanManageMaintenanceServices,
  MaintenanceWindowParams,
  projectMaintenanceWindow,
  requireReadableMaintenanceWindow,
} from '@/lib/api-v2/maintenance-windows';
import {
  endMaintenanceWindowNow,
  processEndedMaintenanceWindow,
} from '@/lib/service-maintenance/windows';

// Ending is naturally idempotent (an ended window is returned unchanged), so there is no
// replay transaction. Held incidents are released right after the end commits instead of
// waiting for the scheduler sweep.
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
    const now = new Date();
    const row = await prisma.$transaction(async tx => {
      // MCP approval recheck inside the end's own transaction; a no-op for REST callers.
      await internalV2MutationGuard()?.(tx);
      return endMaintenanceWindowNow(params.id, { id: actor.id, source: 'API' }, { tx, now });
    });
    // Best effort: the scheduler sweep is the durable backstop if this fails.
    await processEndedMaintenanceWindow(params.id, now).catch(error =>
      logger.warn('maintenance_window.inline_release_failed', {
        maintenanceWindowId: params.id,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return {
      data: projectMaintenanceWindow(row, actor),
      headers: { ...etagHeaders(row.revision), 'Cache-Control': 'no-store' },
    };
  },
});
