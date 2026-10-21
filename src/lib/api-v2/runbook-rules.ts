import { z } from 'zod';
import type { Prisma, ServiceAutomationRule } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { lockServiceRuleForUpdate } from '@/lib/runbooks/locking';
import { getBindingReadiness } from '@/lib/runbooks/binding-readiness';
import {
  createServiceRunbookBindingSchema,
  updateServiceRunbookBindingSchema,
  createRunbookTriggerSchema,
} from '@/lib/runbooks/schemas';
import { etagHeaders, preconditionFailed, requireRevisionIfMatch } from './concurrency';

export const RuleServiceParams = z.object({ id: z.string().cuid() }).strict();
export const RuleParams = RuleServiceParams.extend({ ruleId: z.string().cuid() }).strict();
export const RuleCreateBody = z
  .object({
    configuration: createServiceRunbookBindingSchema,
    trigger: createRunbookTriggerSchema.optional(),
    expectedVersionId: z.string().cuid(),
  })
  .strict();
export const RuleUpdateBody = z
  .object({
    configuration: updateServiceRunbookBindingSchema.refine(
      value => Object.keys(value).length > 0,
      'Provide a configuration field.'
    ),
    expectedVersionId: z.string().cuid(),
  })
  .strict();
export const RuleTriggerBody = createRunbookTriggerSchema;
export const RuleActivationBody = z
  .object({ confirmMatchAll: z.boolean().default(false) })
  .strict();

export async function requireRuleService(tx: Prisma.TransactionClient, serviceId: string) {
  const service = await tx.service.findUnique({ where: { id: serviceId }, select: { id: true } });
  if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
}
export async function requireRule(
  tx: Prisma.TransactionClient,
  serviceId: string,
  ruleId: string,
  request?: Request
) {
  await requireRuleService(tx, serviceId);
  const identity = await tx.serviceAutomationRule.findFirst({
    where: { id: ruleId, serviceId, detachedAt: null },
    select: { id: true },
  });
  if (!identity) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  if (request) await lockServiceRuleForUpdate(tx, serviceId, ruleId);
  const rule = await tx.serviceAutomationRule.findFirst({
    where: { id: ruleId, serviceId, detachedAt: null },
    include: {
      runbook: { select: { publishedVersionId: true } },
      triggers: {
        take: 21,
        include: { conditions: { take: 21, orderBy: { sequence: 'asc' } } },
        orderBy: { id: 'asc' },
      },
    },
  });
  if (!rule) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  if (request && rule.configurationRevision !== requireRevisionIfMatch(request))
    throw preconditionFailed();
  return rule;
}
export function projectRule(
  rule: ServiceAutomationRule & {
    runbook?: { publishedVersionId: string | null };
    triggers?: Array<{
      id: string;
      revision: number;
      event: string;
      conditionLogic: string;
      enabled: boolean;
      conditions: Array<{
        field: string;
        operator: string;
        value: Prisma.JsonValue;
        sequence: number;
      }>;
    }>;
  }
) {
  const data = {
    id: rule.id,
    serviceId: rule.serviceId,
    runbookId: rule.runbookId,
    name: rule.name,
    configurationRevision: rule.configurationRevision,
    enabled: rule.enabled,
    mode: rule.mode,
    versionStrategy: rule.versionStrategy,
    runbookVersionId: rule.runbookVersionId,
    resolvedVersionId:
      rule.versionStrategy === 'PINNED'
        ? rule.runbookVersionId
        : (rule.runbook?.publishedVersionId ?? null),
    defaultAgentId: rule.defaultAgentId,
    defaultAgentPoolId: rule.defaultAgentPoolId,
    agentSelector: rule.agentSelector,
    inputValues: rule.inputValues,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    triggers: (rule.triggers ?? []).map(trigger => ({
      id: trigger.id,
      revision: trigger.revision,
      event: trigger.event,
      conditionLogic: trigger.conditionLogic,
      enabled: trigger.enabled,
      conditions: trigger.conditions.map(condition => ({
        field: condition.field,
        operator: condition.operator,
        value: condition.value,
        sequence: condition.sequence,
      })),
    })),
  };
  if (
    (rule.triggers?.length ?? 0) > 20 ||
    rule.triggers?.some(trigger => trigger.conditions.length > 20) ||
    Buffer.byteLength(JSON.stringify(data), 'utf8') > 1_048_576
  )
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage:
        'This legacy rule exceeds the supported administrative response limits. Review its configuration before editing it through REST.',
    });
  return data;
}
export function ruleResult(rule: Parameters<typeof projectRule>[0]) {
  return {
    data: projectRule(rule),
    headers: { ...etagHeaders(rule.configurationRevision), 'Cache-Control': 'no-store' },
  };
}
export async function reviewRuleReadiness(
  tx: Prisma.TransactionClient,
  serviceId: string,
  ruleId: string
) {
  await requireRule(tx, serviceId, ruleId);
  const rule = await tx.serviceAutomationRule.findFirstOrThrow({
    where: { id: ruleId, serviceId, detachedAt: null },
    include: {
      runbook: { include: { publishedVersion: { include: { inputs: true } } } },
      runbookVersion: { include: { inputs: true } },
      triggers: { include: { conditions: true } },
    },
  });
  return {
    ruleId: rule.id,
    configurationRevision: rule.configurationRevision,
    readiness: await getBindingReadiness({ ...rule, enabled: true }, new Date(), tx),
  };
}

export function projectRuleSummary(
  rule: Pick<
    ServiceAutomationRule,
    | 'id'
    | 'serviceId'
    | 'runbookId'
    | 'name'
    | 'configurationRevision'
    | 'enabled'
    | 'mode'
    | 'versionStrategy'
    | 'runbookVersionId'
    | 'createdAt'
    | 'updatedAt'
  >
) {
  return {
    id: rule.id,
    serviceId: rule.serviceId,
    runbookId: rule.runbookId,
    name: rule.name,
    configurationRevision: rule.configurationRevision,
    enabled: rule.enabled,
    mode: rule.mode,
    versionStrategy: rule.versionStrategy,
    runbookVersionId: rule.runbookVersionId,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}
