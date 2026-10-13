import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  EscalationPolicyUpdateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  escalationTargetExists,
  validateEscalationStep,
  firstEscalationStepIssue,
  type ValidatedEscalationStep,
} from '@/lib/escalation/policy-validation';
import { AppError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ);

    const { id } = await params;
    const policy = await prisma.escalationPolicy.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        services: { select: { id: true, name: true } },
      },
    });

    if (!policy) {
      throw new AppError({
        code: 'ESCALATION_POLICY_NOT_FOUND',
        userMessage: `Escalation policy with id '${id}' was not found.`,
      });
    }

    return apiV2Success(policy, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.ESCALATION_POLICY_MANAGE);

    const { id } = await params;
    const existing = await prisma.escalationPolicy.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError({
        code: 'ESCALATION_POLICY_NOT_FOUND',
        userMessage: `Escalation policy with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = EscalationPolicyUpdateV2Schema.parse(body);

    const validatedStepPayloads: ValidatedEscalationStep[] = [];
    if (validated.steps) {
      for (const [index, step] of validated.steps.entries()) {
        const stepInput = {
          targetType: step.targetType,
          targetUserId: step.targetType === 'USER' ? step.targetId : undefined,
          targetTeamId: step.targetType === 'TEAM' ? step.targetId : undefined,
          targetScheduleId: step.targetType === 'SCHEDULE' ? step.targetId : undefined,
          delayMinutes: step.delayMinutes,
        };
        const stepValidation = validateEscalationStep(stepInput);
        if (!stepValidation.valid) {
          throw new AppError({
            code: 'INVALID_ESCALATION_STEP',
            userMessage: `Step ${index + 1} is invalid: ${firstEscalationStepIssue(stepValidation.issues)}`,
          });
        }
        const exists = await escalationTargetExists(prisma, step.targetType, step.targetId);
        if (!exists) {
          throw new AppError({
            code: 'TARGET_NOT_FOUND',
            userMessage: `Target '${step.targetId}' for step ${index + 1} (${step.targetType}) does not exist.`,
          });
        }
        validatedStepPayloads.push(stepValidation.step);
      }
    }

    const updated = await prisma.$transaction(async tx => {
      await tx.escalationPolicy.update({
        where: { id },
        data: {
          name: validated.name,
          description: validated.description,
        },
      });

      if (validated.steps) {
        await tx.escalationRule.deleteMany({ where: { policyId: id } });
        for (const [index, stepPayload] of validatedStepPayloads.entries()) {
          await tx.escalationRule.create({
            data: {
              policyId: id,
              stepOrder: index,
              targetType: stepPayload.targetType,
              targetUserId: stepPayload.targetUserId,
              targetTeamId: stepPayload.targetTeamId,
              targetScheduleId: stepPayload.targetScheduleId,
              delayMinutes: stepPayload.delayMinutes,
              notificationChannels: stepPayload.notificationChannels,
              notifyOnlyTeamLead: stepPayload.notifyOnlyTeamLead,
            },
          });
        }
      }

      return tx.escalationPolicy.findUnique({
        where: { id },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });
    });

    await logV2Audit({
      action: 'escalation_policy.updated',
      entityType: 'ESCALATION_POLICY',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: validated,
    });

    return apiV2Success(updated, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.ESCALATION_POLICY_MANAGE);

    const { id } = await params;
    const policy = await prisma.escalationPolicy.findUnique({
      where: { id },
      include: {
        services: { select: { id: true, name: true } },
      },
    });

    if (!policy) {
      throw new AppError({
        code: 'ESCALATION_POLICY_NOT_FOUND',
        userMessage: `Escalation policy with id '${id}' was not found.`,
      });
    }

    if (policy.services.length > 0) {
      const serviceNames = policy.services.map(s => s.name).join(', ');
      throw new AppError({
        code: 'ESCALATION_POLICY_IN_USE',
        userMessage: `Cannot delete escalation policy '${policy.name}' because ${policy.services.length} service(s) are using it (${serviceNames}). Reassign those services first.`,
      });
    }

    await prisma.$transaction(async tx => {
      await tx.escalationRule.deleteMany({ where: { policyId: id } });
      await tx.escalationPolicy.delete({ where: { id } });
    });

    await logV2Audit({
      action: 'escalation_policy.deleted',
      entityType: 'ESCALATION_POLICY',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { name: policy.name },
    });

    return apiV2Success({ success: true, message: `Escalation policy '${policy.name}' deleted successfully.` }, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
