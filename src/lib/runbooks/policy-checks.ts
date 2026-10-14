import 'server-only';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  flattenSteps,
  parseRunbookDefinition,
  resolveInputTemplates,
  sortJsonValue,
  isSecretReference,
} from './definition';
import { requiresAgent } from './types';
import { applyRunbookInputDefaults, validateBindingInputValues } from './bindings';
import { signExecutionEnvelope } from './execution-signing';
export function policyCheckSteps(
  steps: ReturnType<typeof flattenSteps>,
  values: Record<string, unknown>
) {
  const safeValues = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      /secret|token|password|credential|authorization|api.?key/i.test(key) ||
      isSecretReference(value)
        ? '[REDACTED]'
        : value,
    ])
  );
  return steps
    .filter(step => requiresAgent(step.type))
    .map(step => ({ ...step, config: resolveInputTemplates(step.config, safeValues) }));
}
export function samePolicySnapshot(before: unknown, after: unknown) {
  return JSON.stringify(sortJsonValue(before)) === JSON.stringify(sortJsonValue(after));
}
export async function requestRulePolicyChecks(serviceId: string, ruleId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ServiceRunbookBinding" WHERE id = ${ruleId} AND "serviceId" = ${serviceId} FOR UPDATE`;
    const rule = await tx.serviceAutomationRule.findFirst({
      where: { id: ruleId, serviceId },
      include: {
        runbook: { include: { publishedVersion: { include: { inputs: true } } } },
        runbookVersion: { include: { inputs: true } },
      },
    });
    if (!rule) throw new Error('Service automation rule not found.');
    const version =
      rule.versionStrategy === 'PINNED' ? rule.runbookVersion : rule.runbook.publishedVersion;
    if (!version || !['PUBLISHED', 'RETIRED'].includes(version.state) || rule.runbook.archivedAt)
      throw new Error('A published immutable version is required.');
    const values = applyRunbookInputDefaults(
      version.inputs,
      rule.inputValues as Record<string, unknown>
    );
    validateBindingInputValues(version.inputs, values);
    const definition = parseRunbookDefinition(version.definition, version.inputs);
    const steps = policyCheckSteps(flattenSteps(definition), values);
    if (steps.length > 200) throw new Error('Policy checks support at most 200 flattened actions.');
    if (!steps.length) throw new Error('This workflow has no Agent actions to check.');
    const selector = Object.entries(rule.agentSelector as Record<string, string>).map(
      ([key, value]) => {
        if (value.includes('incident.labels.'))
          throw new Error(
            'This selector requires an incident context. Preview from that incident to check the resolved target.'
          );
        const resolved = resolveInputTemplates(value, values);
        if (typeof resolved !== 'string' || !resolved)
          throw new Error('A selector input is unavailable.');
        return [key, resolved] as const;
      }
    );
    if (!rule.defaultAgentId && !rule.defaultAgentPoolId && !selector.length)
      throw new Error('Choose an explicit Agent, pool or selector.');
    const now = new Date();
    const agents = await tx.runbookAgent.findMany({
      where: {
        status: 'ONLINE',
        lastHeartbeatAt: { gte: new Date(now.getTime() - 90_000) },
        ...(rule.defaultAgentId ? { id: rule.defaultAgentId } : {}),
        ...(rule.defaultAgentPoolId
          ? { poolMemberships: { some: { poolId: rule.defaultAgentPoolId } } }
          : {}),
        ...(selector.length
          ? { AND: selector.map(([key, value]) => ({ labels: { path: [key], equals: value } })) }
          : {}),
      },
      select: { id: true },
      take: 11,
    });
    if (!agents.length || agents.length > 10)
      throw new Error('A policy check requires 1–10 online targets. Narrow the selector.');
    const pending = await tx.runbookPolicyCheck.count({
      where: { ruleId, status: 'PENDING', expiresAt: { gt: now } },
    });
    if (pending)
      throw new Error(
        'A policy check is already pending. Wait for the Agent response or expiration.'
      );
    await tx.runbookPolicyCheck.createMany({
      data: agents.map(agent => ({
        id: crypto.randomUUID(),
        ruleId,
        agentId: agent.id,
        versionId: version.id,
        checksum: version.checksum,
        steps: steps as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(now.getTime() + 5 * 60_000),
        createdById: actorId,
      })),
    });
    await logAudit(
      {
        action: 'runbook.rule.policy_check.requested',
        entityType: 'RUNBOOK',
        entityId: rule.runbookId,
        actorId,
        details: { serviceId, ruleId, targets: agents.length, versionId: version.id },
      },
      tx
    );
    return { saved: true, checkedTargets: agents.length };
  });
}
export async function pendingAgentPolicyChecks(agentId: string) {
  const checks = await prisma.runbookPolicyCheck.findMany({
    where: { agentId, status: 'PENDING', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  return Promise.all(
    checks.map(check =>
      signExecutionEnvelope({
        kind: 'POLICY_CHECK' as const,
        id: check.id,
        signingAgentId: agentId,
        executionDeadlineAt: check.expiresAt.toISOString(),
        leaseExpiresAt: check.expiresAt.toISOString(),
        steps: check.steps,
      })
    )
  );
}
export const policyCheckResultSchema = z
  .object({
    id: z.string().uuid(),
    policyHash: z.string().regex(/^[a-f0-9]{64}$/),
    results: z
      .array(
        z
          .object({
            key: z.string().max(100),
            allowed: z.boolean().nullable(),
            reason: z.literal('REDACTED_INPUT').optional(),
          })
          .strict()
          .refine(result => result.allowed !== null || result.reason === 'REDACTED_INPUT')
      )
      .max(200),
  })
  .strict();
export async function submitPolicyCheck(agentId: string, raw: unknown) {
  const input = policyCheckResultSchema.parse(raw);
  return prisma.$transaction(async tx => {
    const check = await tx.runbookPolicyCheck.findFirst({
      where: { id: input.id, agentId, status: 'PENDING', expiresAt: { gt: new Date() } },
    });
    if (!check)
      throw new Error('Policy check is expired, already completed or belongs to another Agent.');
    const expected = (check.steps as unknown as Array<{ key: string }>).map(step => step.key);
    if (
      input.results.length !== expected.length ||
      new Set(input.results.map(result => result.key)).size !== expected.length ||
      !expected.every(key => input.results.some(result => result.key === key))
    )
      throw new Error('Policy result must address every frozen step exactly once.');
    const frozen = check.steps as unknown as Array<{ key: string; config: unknown }>;
    const results = input.results.map(result =>
      frozen.some(
        step => step.key === result.key && JSON.stringify(step.config).includes('[REDACTED]')
      )
        ? { key: result.key, allowed: null, reason: 'REDACTED_INPUT' as const }
        : result
    );
    const updated = await tx.runbookPolicyCheck.updateMany({
      where: { id: check.id, agentId, status: 'PENDING' },
      data: {
        status: results.some(result => result.allowed === false)
          ? 'BLOCKED'
          : results.some(result => result.allowed === null)
            ? 'DEFERRED'
            : 'PASSED',
        policyHash: input.policyHash,
        results,
        checkedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new Error('Policy result has already been consumed.');
    return { accepted: true };
  });
}
