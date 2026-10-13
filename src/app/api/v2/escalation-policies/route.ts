import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  buildCursorWhere,
  enforceV2Authorization,
  enforceV2RateLimit,
  formatCursorPagination,
  logV2Audit,
  parsePaginationParams,
  EscalationPolicyCreateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { assertEscalationPolicyNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import {
  escalationTargetExists,
  validateEscalationStep,
  firstEscalationStepIssue,
  type ValidatedEscalationStep,
} from '@/lib/escalation/policy-validation';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ);

    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const search = searchParams.get('search')?.trim();

    const filters: Prisma.EscalationPolicyWhereInput[] = [];
    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.EscalationPolicyWhereInput);
    }

    const where: Prisma.EscalationPolicyWhereInput = filters.length > 0 ? { AND: filters } : {};

    const policies = await prisma.escalationPolicy.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        steps: {
          orderBy: { stepOrder: 'asc' },
        },
        _count: {
          select: { services: true },
        },
      },
    });

    const mapped = policies.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      stepCount: p.steps.length,
      serviceCount: p._count.services,
      steps: p.steps,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    const result = formatCursorPagination(mapped, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.ESCALATION_POLICY_MANAGE);

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = EscalationPolicyCreateV2Schema.parse(body);

    let normalizedName = validated.name;
    try {
      normalizedName = await assertEscalationPolicyNameAvailable(validated.name);
    } catch (err) {
      if (err instanceof UniqueNameConflictError) {
        throw new AppError({
          code: 'ESCALATION_POLICY_NAME_CONFLICT',
          userMessage: `An escalation policy with the name '${validated.name}' already exists.`,
        });
      }
      throw err;
    }

    // Validate steps & targets
    const validatedStepPayloads: ValidatedEscalationStep[] = [];
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

      const targetExists = await escalationTargetExists(prisma, step.targetType, step.targetId);
      if (!targetExists) {
        throw new AppError({
          code: 'TARGET_NOT_FOUND',
          userMessage: `Target '${step.targetId}' for step ${index + 1} (${step.targetType}) does not exist.`,
        });
      }

      validatedStepPayloads.push(stepValidation.step);
    }

    const created = await prisma.$transaction(async tx => {
      const policy = await tx.escalationPolicy.create({
        data: {
          name: normalizedName,
          description: validated.description ?? null,
        },
      });

      for (const [index, stepPayload] of validatedStepPayloads.entries()) {
        await tx.escalationRule.create({
          data: {
            policyId: policy.id,
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

      return tx.escalationPolicy.findUnique({
        where: { id: policy.id },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });
    });

    await logV2Audit({
      action: 'escalation_policy.created',
      entityType: 'ESCALATION_POLICY',
      entityId: created!.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { name: created!.name, stepCount: created!.steps.length },
    });

    return apiV2Created(created, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
