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
import { escalationTargetExists, validateEscalationStep } from '@/lib/escalation/policy-validation';
import { AppError } from '@/lib/errors';
import type { NotificationChannel, Prisma } from '@prisma/client';

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
      repeatCount: p.repeatCount,
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
      throw new AppError({ code: 'INVALID_JSON', status: 400, userMessage: 'Invalid JSON request body.' });
    });

    const validated = EscalationPolicyCreateV2Schema.parse(body);

    let normalizedName = validated.name;
    try {
      normalizedName = await assertEscalationPolicyNameAvailable(validated.name);
    } catch (err) {
      if (err instanceof UniqueNameConflictError) {
        throw new AppError({
          code: 'ESCALATION_POLICY_NAME_CONFLICT',
          status: 409,
          userMessage: `An escalation policy with the name '${validated.name}' already exists.`,
        });
      }
      throw err;
    }

    // Validate steps & targets
    for (const [index, step] of validated.steps.entries()) {
      const stepIssue = validateEscalationStep(step.delayMinutes, step.targetType, step.targetId);
      if (stepIssue) {
        throw new AppError({
          code: 'INVALID_ESCALATION_STEP',
          status: 400,
          userMessage: `Step ${index + 1} is invalid: ${stepIssue}`,
        });
      }

      const targetExists = await escalationTargetExists(step.targetType, step.targetId);
      if (!targetExists) {
        throw new AppError({
          code: 'TARGET_NOT_FOUND',
          status: 400,
          userMessage: `Target '${step.targetId}' for step ${index + 1} (${step.targetType}) does not exist.`,
        });
      }
    }

    const created = await prisma.$transaction(async tx => {
      const policy = await tx.escalationPolicy.create({
        data: {
          name: normalizedName,
          description: validated.description ?? null,
          repeatCount: validated.repeatCount,
        },
      });

      for (const [index, step] of validated.steps.entries()) {
        await tx.escalationRule.create({
          data: {
            policyId: policy.id,
            stepOrder: index + 1,
            delayMinutes: step.delayMinutes,
            targetType: step.targetType,
            targetId: step.targetId,
            channels: ['EMAIL' as NotificationChannel],
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
