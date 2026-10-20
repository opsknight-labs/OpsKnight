import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const { policy, usage } = await prisma.$transaction(async tx => {
      const [policy, services, versionRefs, decisions] = await Promise.all([
        tx.escalationPolicy.findUnique({
          where: { id: params.id },
          select: {
            id: true,
            services: { select: { id: true, name: true }, orderBy: { id: 'asc' }, take: 101 },
            steps: {
              select: { id: true, stepOrder: true, targetType: true, targetUserId: true, targetTeamId: true, targetScheduleId: true },
              orderBy: { stepOrder: 'asc' },
              take: 501,
            },
          },
        }),
        tx.service.count({ where: { escalationPolicyId: params.id } }),
        tx.automationVersionPolicyRef.count({ where: { escalationPolicyId: params.id } }),
        tx.incidentAutomationDecision.count({ where: { escalationPolicyId: params.id } }),
      ]);
      return { policy, usage: { services, versionRefs, decisions } };
    }, { isolationLevel: 'RepeatableRead' });
    if (!policy) throw new AppError({ code: 'ESCALATION_POLICY_NOT_FOUND' });

    const displayedSteps = policy.steps.slice(0, 500);
    const userIds = displayedSteps.flatMap(step => step.targetType === 'USER' && step.targetUserId ? [step.targetUserId] : []);
    const teamIds = displayedSteps.flatMap(step => step.targetType === 'TEAM' && step.targetTeamId ? [step.targetTeamId] : []);
    const scheduleIds = displayedSteps.flatMap(step => step.targetType === 'SCHEDULE' && step.targetScheduleId ? [step.targetScheduleId] : []);
    const [users, teams, schedules] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds }, status: 'ACTIVE' }, select: { id: true } }),
      prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true } }),
      prisma.onCallSchedule.findMany({ where: { id: { in: scheduleIds } }, select: { id: true } }),
    ]);
    const validUsers = new Set(users.map(user => user.id));
    const validTeams = new Set(teams.map(team => team.id));
    const validSchedules = new Set(schedules.map(schedule => schedule.id));
    const targets = displayedSteps.map(step => {
      const targetId = step.targetType === 'USER' ? step.targetUserId : step.targetType === 'TEAM' ? step.targetTeamId : step.targetScheduleId;
      const exists = Boolean(targetId && (step.targetType === 'USER' ? validUsers.has(targetId) : step.targetType === 'TEAM' ? validTeams.has(targetId) : validSchedules.has(targetId)));
      return { stepId: step.id, stepOrder: step.stepOrder, targetType: step.targetType, targetId, exists };
    });
    return {
      data: {
        policyId: policy.id,
        services: policy.services.slice(0, 100),
        usage,
        truncated: { services: policy.services.length > 100, targets: policy.steps.length > 500 },
        targets,
        valid: policy.steps.length <= 500 && targets.every(target => target.exists),
        deletionAllowed: Object.values(usage).every(count => count === 0),
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
