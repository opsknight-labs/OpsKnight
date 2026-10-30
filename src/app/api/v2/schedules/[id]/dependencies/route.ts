import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const schedule = await prisma.onCallSchedule.findUnique({
      where: { id: params.id },
      select: { id: true, revision: true },
    });
    if (!schedule) throw new AppError({ code: 'SCHEDULE_NOT_FOUND' });
    const [total, rules] = await Promise.all([
      prisma.escalationRule.count({
        where: { targetType: 'SCHEDULE', targetScheduleId: params.id },
      }),
      prisma.escalationRule.findMany({
        where: { targetType: 'SCHEDULE', targetScheduleId: params.id },
        orderBy: [{ policyId: 'asc' }, { stepOrder: 'asc' }, { id: 'asc' }],
        take: 100,
        select: {
          id: true,
          policyId: true,
          stepOrder: true,
          policy: { select: { name: true, archivedAt: true } },
        },
      }),
    ]);
    return {
      data: {
        scheduleId: schedule.id,
        revision: schedule.revision,
        total,
        truncated: total > rules.length,
        escalationSteps: rules.map(rule => ({
          id: rule.id,
          policyId: rule.policyId,
          policyName: rule.policy.name,
          policyArchived: rule.policy.archivedAt !== null,
          stepOrder: rule.stepOrder,
        })),
      },
      headers: { 'Cache-Control': 'private, no-store' },
    };
  },
});
