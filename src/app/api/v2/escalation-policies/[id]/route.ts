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
import { escalationTargetExists, validateEscalationStep } from '@/lib/escalation/policy-validation';
import { AppError } from '@/lib/errors';
import type { NotificationChannel } from '@prisma/client';

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
        status: 404,
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
        status: 404,
        userMessage: `Escalation policy with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', status: 400, userMessage: 'Invalid JSON request body.' });
    });

    const validated = EscalationPolicyUpdateV2Schema.parse(body);

    if (validated.steps) {
      for (const [index, step] of validated.steps.entries()) {
        const issue = validateEscalationStep(step.delayMinutes, step.targetType, step.targetId);
        if (issue) {
          throw new AppError({
            code: 'INVALID_ESCALATION_STEP',
            status: 400,
            userMessage: `Step ${index + 1} is invalid: ${issue}`,
          });
        }
        const exists = await escalationTargetExists(step.targetType, step.targetId);
        if (!exists) {
          throw new AppError({
            code: 'TARGET_NOT_FOUND',
            status: 400,
            userMessage: `Target '${step.targetId}' for step ${index + 1} (${step.targetType}) does not exist.`,
          });
        }
      }
    }

    const updated = await prisma.$transaction(async tx => {
      await tx.escalationPolicy.update({
        where: { id },
        data: {
          name: validated.name,
          description: validated.description,
          repeatCount: validated.repeatCount,
        },
      });

      if (validated.steps) {
        await tx.escalationRule.deleteMany({ where: { policyId: id } });
        for (const [index, step] of validated.steps.entries()) {
          await tx.escalationRule.create({
            data: {
              policyId: id,
              stepOrder: index + 1,
              delayMinutes: step.delayMinutes,
              targetType: step.targetType,
              targetId: step.targetId,
              channels: ['EMAIL' as NotificationChannel],
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
        status: 404,
        userMessage: `Escalation policy with id '${id}' was not found.`,
      });
    }

    if (policy.services.length > 0) {
      const serviceNames = policy.services.map(s => s.name).join(', ');
      throw new AppError({
        code: 'ESCALATION_POLICY_IN_USE',
        status: 409,
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
