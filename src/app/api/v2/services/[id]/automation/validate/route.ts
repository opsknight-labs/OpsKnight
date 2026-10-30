import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { snapshotSchema } from '@/lib/automation/contract';
import { validateAutomationSnapshot } from '@/lib/automation/authoring';
import { isSensitiveValue } from '@/lib/automation/context/privacy';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ snapshot: snapshotSchema }).strict(),
  handler: async ({ params, actor, body }) => {
    const data = await prisma.$transaction(async tx => {
      await requireAutomationService(tx, params.id, actor);
      const { issues } = await validateAutomationSnapshot(tx, params.id, body.snapshot);
      return {
        valid: !issues.some(issue => issue.level === 'ERROR'),
        requiresActivationReview: true,
        issues: issues.map(issue => ({
          ...issue,
          message: isSensitiveValue(issue.message) ? '[redacted]' : issue.message,
          ...(issue.ruleId && isSensitiveValue(issue.ruleId) ? { ruleId: '[redacted]' } : {}),
        })),
      };
    });
    return { data, headers: { 'Cache-Control': 'no-store' } };
  },
});
