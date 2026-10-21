import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { escalationStepOrdersAreContiguous, validateEscalationStep } from './policy-validation';

/** A single, bounded database snapshot shared by dependency and validation reads. */
export async function inspectEscalationPolicy(id: string) {
  return prisma.$transaction(async tx => {
    const [policy, services, versionRefs, decisions] = await Promise.all([
      tx.escalationPolicy.findUnique({
        where: { id },
        select: {
          id: true, revision: true, archivedAt: true,
          services: { select: { id: true, name: true }, orderBy: { id: 'asc' }, take: 101 },
          steps: {
            select: {
              id: true, stepOrder: true, targetType: true, targetUserId: true,
              targetTeamId: true, targetScheduleId: true, delayMinutes: true,
              notificationChannels: true, notifyOnlyTeamLead: true,
              conditions: { select: { field: true, operator: true, values: true }, take: 11 },
            },
            orderBy: { stepOrder: 'asc' }, take: 501,
          },
        },
      }),
      tx.service.count({ where: { escalationPolicyId: id } }),
      tx.automationVersionPolicyRef.count({ where: { escalationPolicyId: id } }),
      tx.incidentAutomationDecision.count({ where: { escalationPolicyId: id } }),
    ]);
    if (!policy) throw new AppError({ code: 'ESCALATION_POLICY_NOT_FOUND' });
    const displayedSteps = policy.steps.slice(0, 500);
    const userIds = displayedSteps.flatMap(step => step.targetType === 'USER' && step.targetUserId ? [step.targetUserId] : []);
    const teamIds = displayedSteps.flatMap(step => step.targetType === 'TEAM' && step.targetTeamId ? [step.targetTeamId] : []);
    const scheduleIds = displayedSteps.flatMap(step => step.targetType === 'SCHEDULE' && step.targetScheduleId ? [step.targetScheduleId] : []);
    const [users, teams, schedules] = await Promise.all([
      tx.user.findMany({ where: { id: { in: userIds }, status: 'ACTIVE' }, select: { id: true } }),
      tx.team.findMany({ where: { id: { in: teamIds } }, select: { id: true } }),
      tx.onCallSchedule.findMany({ where: { id: { in: scheduleIds } }, select: { id: true } }),
    ]);
    const validUsers = new Set(users.map(user => user.id));
    const validTeams = new Set(teams.map(team => team.id));
    const validSchedules = new Set(schedules.map(schedule => schedule.id));
    const targets = displayedSteps.map(step => {
      const targetId = step.targetType === 'USER' ? step.targetUserId : step.targetType === 'TEAM' ? step.targetTeamId : step.targetScheduleId;
      const exists = Boolean(targetId && (step.targetType === 'USER' ? validUsers.has(targetId) : step.targetType === 'TEAM' ? validTeams.has(targetId) : validSchedules.has(targetId)));
      return { stepId: step.id, stepOrder: step.stepOrder, targetType: step.targetType, targetId, exists };
    });
    const issues: Array<{ code: string; stepId: string | null; field: string | null; message: string }> = [];
    if (policy.archivedAt) issues.push({ code: 'ARCHIVED', stepId: null, field: null, message: 'Policy is archived.' });
    if (displayedSteps.length === 0) issues.push({ code: 'NO_STEPS', stepId: null, field: 'steps', message: 'Policy has no escalation steps.' });
    if (policy.steps.length > 500) issues.push({ code: 'TOO_MANY_STEPS', stepId: null, field: 'steps', message: 'Validation is limited to 500 steps.' });
    if (!escalationStepOrdersAreContiguous(displayedSteps.map(step => step.stepOrder))) {
      issues.push({ code: 'STEP_ORDER', stepId: null, field: 'steps', message: 'Step orders must be contiguous from zero.' });
    }
    for (const [index, step] of displayedSteps.entries()) {
      const validated = validateEscalationStep({ ...step, conditions: step.conditions });
      if (!validated.valid) for (const issue of validated.issues) {
        issues.push({ code: 'INVALID_STEP', stepId: step.id, field: issue.field, message: issue.message });
      }
      if (!targets.at(index)?.exists) issues.push({
        code: 'TARGET_UNAVAILABLE', stepId: step.id, field: 'targetId',
        message: 'Step target is missing or inactive.',
      });
    }
    const usage = { services, versionRefs, decisions };
    return {
      policyId: policy.id, revision: policy.revision,
      services: policy.services.slice(0, 100), usage,
      truncated: { services: policy.services.length > 100, targets: policy.steps.length > 500 },
      targets, valid: issues.length === 0, issues,
      deletionAllowed: Object.values(usage).every(count => count === 0),
    };
  }, { isolationLevel: 'RepeatableRead' });
}
