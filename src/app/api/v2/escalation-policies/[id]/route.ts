import { NextRequest } from 'next/server';
import { internalV2MutationGuard } from '@/lib/api-v2/internal-context';
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
import { etagHeaders, ifMatchWhere, parseIfMatch, withIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  escalationTargetExists,
  validateEscalationStep,
  firstEscalationStepIssue,
  type ValidatedEscalationStep,
} from '@/lib/escalation/policy-validation';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(
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
        steps: {
          orderBy: { stepOrder: 'asc' },
          include: { conditions: true },
        },
        services: { select: { id: true, name: true } },
      },
    });

    if (!policy) {
      throw new AppError({
        code: 'ESCALATION_POLICY_NOT_FOUND',
        userMessage: `Escalation policy with id '${id}' was not found.`,
      });
    }

    return apiV2Success(policy, {
      headers: { ...rlHeaders, ...etagHeaders(policy.revision) },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const PATCH = withV2Observability(async function PATCH(
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
          notificationChannels: step.notificationChannels,
          notifyOnlyTeamLead: step.notifyOnlyTeamLead,
          conditions: step.conditions,
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

    const expected = parseIfMatch(req);

    const updated = await withIfMatch(expected, () =>
      prisma.$transaction(async tx => {
        // MCP approval recheck inside the change's own transaction; a no-op for REST callers.
        await internalV2MutationGuard()?.(tx);
        await tx.escalationPolicy.update({
          where: { id, ...ifMatchWhere(expected) },
          data: {
            name: validated.name,
            description: validated.description,
            // Steps are part of the policy's representation: always move the revision so a
            // steps-only edit changes the ETag even when no parent column changed.
            updatedAt: new Date(),
          },
        });

        if (validated.steps) {
          await tx.escalationRuleCondition.deleteMany({ where: { rule: { policyId: id } } });
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
                ...(stepPayload.conditions && stepPayload.conditions.length > 0
                  ? {
                      conditions: {
                        create: stepPayload.conditions.map(c => ({
                          field: c.field,
                          operator: c.operator,
                          values: c.values,
                        })),
                      },
                    }
                  : {}),
              },
            });
          }
        }

        const result = await tx.escalationPolicy.findUnique({
          where: { id },
          include: {
            steps: {
              orderBy: { stepOrder: 'asc' },
              include: { conditions: true },
            },
          },
        });

        await logV2Audit({
          action: 'escalation_policy.updated',
          entityType: 'ESCALATION_POLICY',
          entityId: id,
          actorId: actor.id,
          apiKeyId: apiKey.id,
          details: validated,
          tx,
        });

        return result;
      })
    );

    return apiV2Success(updated, {
      headers: { ...rlHeaders, ...etagHeaders(updated!.revision) },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const DELETE = withV2Observability(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.ESCALATION_POLICY_MANAGE);

    const { id } = await params;
    await prisma.$transaction(
      async tx => {
        // MCP approval recheck inside the deletion's own transaction; a no-op for REST callers.
        await internalV2MutationGuard()?.(tx);
        // A service assigning this policy must acquire a key-share FK lock. FOR UPDATE
        // serializes that assignment with the dependency check and deletion.
        const locked = await tx.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT "id", "name" FROM "EscalationPolicy" WHERE "id" = ${id} FOR UPDATE
      `;
        const policy = locked[0];
        if (!policy) throw new AppError({ code: 'ESCALATION_POLICY_NOT_FOUND' });
        const [services, versionRefs, decisions] = await Promise.all([
          tx.service.count({ where: { escalationPolicyId: id } }),
          tx.automationVersionPolicyRef.count({ where: { escalationPolicyId: id } }),
          tx.incidentAutomationDecision.count({ where: { escalationPolicyId: id } }),
        ]);
        if (services || versionRefs || decisions) {
          throw new AppError({
            code: 'ESCALATION_POLICY_IN_USE',
            userMessage:
              'Reassign services and retire historical automation references before deleting this policy.',
            details: { services, versionRefs, decisions },
          });
        }
        await tx.escalationRuleCondition.deleteMany({ where: { rule: { policyId: id } } });
        await tx.escalationRule.deleteMany({ where: { policyId: id } });
        await tx.escalationPolicy.delete({ where: { id } });
        await logV2Audit({
          action: 'escalation_policy.deleted',
          entityType: 'ESCALATION_POLICY',
          entityId: id,
          actorId: actor.id,
          apiKeyId: apiKey.id,
          details: { name: policy.name },
          tx,
        });
      },
      { timeout: 10_000 }
    );

    return apiV2Success(
      { success: true, message: 'Escalation policy deleted successfully.' },
      { headers: rlHeaders }
    );
  } catch (error) {
    return apiV2Error(error, req);
  }
});
