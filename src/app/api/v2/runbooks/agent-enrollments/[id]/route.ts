import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { FleetAgentParams, requireFleetAgent } from '@/lib/api-v2/runbook-fleet';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_READ,
  paramsSchema: FleetAgentParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const row = await requireFleetAgent(prisma, params.id);
    return {
      data: {
        id: row.id,
        status: row.status,
        enrollmentState:
          row.status === 'REVOKED'
            ? 'REVOKED'
            : row.enrolledAt
              ? 'CONSUMED'
              : row.enrollmentExpiresAt
                ? row.enrollmentExpiresAt.getTime() <= Date.now()
                  ? 'EXPIRED'
                  : 'PENDING'
                : 'UNKNOWN',
        expiresAt: row.enrollmentExpiresAt,
        enrolledAt: row.enrolledAt,
        revokedAt: row.revokedAt,
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
