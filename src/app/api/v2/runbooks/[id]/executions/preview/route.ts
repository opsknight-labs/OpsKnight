import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { RunbookExecuteV2Schema } from '@/lib/api-v2/validation';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { resolveV2RunbookExecution } from '@/lib/api-v2/runbook-execution';
import { previewRunbookExecution } from '@/lib/runbooks/orchestrator';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: RunbookExecuteV2Schema.omit({ expectedPlanDigest: true }).strict(),
  handler: async ({ params, body, actor }) => {
    const resolved = await resolveV2RunbookExecution(prisma, params, body, actor);
    const preview = await previewRunbookExecution(resolved);
    return {
      data: {
        digest: preview.digest,
        expiresAt: preview.expiresAt,
        versionId: preview.versionId,
        version: preview.version,
        checksum: preview.checksum,
        agentId: preview.agentId,
        agentPoolId: preview.agentPoolId,
        timeoutSeconds: preview.timeoutSeconds,
        readiness: preview.readiness,
        steps: preview.steps.map(
          ({ key, name, type, risk, purpose, requiresApproval, timeoutSeconds }) => ({
            key,
            name,
            type,
            risk,
            purpose,
            requiresApproval,
            timeoutSeconds,
          })
        ),
      },
    };
  },
});
