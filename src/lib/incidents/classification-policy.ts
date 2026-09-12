import 'server-only';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertCanModifyService, getUserPermissions } from '@/lib/rbac';
import { emitAuditEvent } from '@/lib/audit';
import { IncidentResponsePolicyError } from '@/lib/incident-sla/policy-config';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import type { AuthorizedPolicyActor, PolicyAuditSource } from './policy-actor';

export const classificationPolicyInput = z
  .object({
    scopeKey: z
      .string()
      .regex(/^(workspace|service:[A-Za-z0-9_-]+|integration:[A-Za-z0-9_-]+)$/)
      .default('workspace'),
    expectedVersion: z.number().int().min(0).max(2_147_483_646),
    derivePriorityFromUrgency: z.boolean().default(false),
    priorityFallbackMode: z.enum(['INHERIT', 'ENABLED', 'DISABLED']).optional(),
    rules: z
      .array(
        z
          .object({
            matchValue: z.enum(['critical', 'error', 'warning', 'info']),
            priorityMode: z.enum(['INHERIT', 'FALLBACK', 'SET', 'CLEAR']).default('SET'),
            priority: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']).nullable(),
            urgencyMode: z.enum(['INHERIT', 'SET', 'DEFAULT']).default('SET'),
            urgency: z.enum(['HIGH', 'MEDIUM', 'LOW']).nullable(),
          })
          .strict()
      )
      .length(4),
  })
  .strict()
  .refine(input => new Set(input.rules.map(rule => rule.matchValue)).size === 4, {
    message: 'Each alert severity must have exactly one mapping.',
  })
  .superRefine((input, context) => {
    if (input.scopeKey === 'workspace' && input.priorityFallbackMode === 'INHERIT')
      context.addIssue({
        code: 'custom',
        path: ['priorityFallbackMode'],
        message: 'Workspace fallback mode cannot inherit.',
      });
    for (const [index, rule] of input.rules.entries()) {
      if ((rule.priorityMode === 'SET') !== (rule.priority !== null))
        context.addIssue({
          code: 'custom',
          path: ['rules', index, 'priority'],
          message: 'SET requires a priority; INHERIT/FALLBACK/CLEAR require null.',
        });
      if ((rule.urgencyMode === 'SET') !== (rule.urgency !== null))
        context.addIssue({
          code: 'custom',
          path: ['rules', index, 'urgency'],
          message: 'SET requires urgency; INHERIT/DEFAULT require null.',
        });
    }
  });

export async function saveWorkspaceClassificationPolicy(rawInput: unknown) {
  const legacy = rawInput as { rules?: Array<Record<string, unknown>> };
  return saveClassificationPolicy(
    {
      ...(rawInput as object),
      scopeKey: 'workspace',
      rules: legacy.rules?.map(rule => ({
        ...rule,
        priorityMode: rule.priorityMode ?? (rule.priority == null ? 'CLEAR' : 'SET'),
        urgencyMode: rule.urgencyMode ?? 'SET',
      })),
    },
    'UI'
  );
}

export async function saveClassificationPolicy(
  rawInput: unknown,
  source: PolicyAuditSource = 'UI',
  authorizedActor?: AuthorizedPolicyActor
) {
  const input = classificationPolicyInput.parse(rawInput);
  const priorityFallbackMode =
    input.priorityFallbackMode ??
    (input.derivePriorityFromUrgency
      ? 'ENABLED'
      : input.scopeKey === 'workspace'
        ? 'DISABLED'
        : 'INHERIT');
  const permissions = authorizedActor
    ? {
        authenticated: true,
        id: authorizedActor.actorId,
        capabilities: authorizedActor.capabilities,
      }
    : await getUserPermissions();
  if (!permissions.authenticated || !permissions.id) {
    throw new IncidentResponsePolicyError('UNAUTHORIZED');
  }
  if (authorizedActor) {
    if (!permissions.capabilities.includes('admin.manage'))
      throw new IncidentResponsePolicyError('UNAUTHORIZED');
  } else if (input.scopeKey.startsWith('service:')) {
    await assertCanModifyService(input.scopeKey.slice(8));
  } else if (input.scopeKey.startsWith('integration:')) {
    const integration = await prisma.integration.findUnique({
      where: { id: input.scopeKey.slice(12) },
      select: { serviceId: true },
    });
    if (!integration) throw new IncidentResponsePolicyError('NOT_FOUND');
    await assertCanModifyService(integration.serviceId);
  } else if (!permissions.capabilities.includes('admin.manage')) {
    throw new IncidentResponsePolicyError('UNAUTHORIZED');
  }

  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`incident-classification:${input.scopeKey}`}, 0))`;
    if (input.scopeKey.startsWith('service:')) {
      const id = input.scopeKey.slice(8);
      if (!(await tx.service.findUnique({ where: { id }, select: { id: true } })))
        throw new IncidentResponsePolicyError('NOT_FOUND');
    }
    if (input.scopeKey.startsWith('integration:')) {
      const id = input.scopeKey.slice(12);
      if (!(await tx.integration.findUnique({ where: { id }, select: { id: true } })))
        throw new IncidentResponsePolicyError('NOT_FOUND');
    }
    const previous = await tx.incidentClassificationPolicy.findFirst({
      where: { scopeKey: input.scopeKey, sealedAt: { not: null } },
      orderBy: { version: 'desc' },
    });
    if ((previous?.version ?? 0) !== input.expectedVersion) {
      addOperationalMetric('opsknight_response_policy_conflicts_total', 1, {
        scope_type: input.scopeKey.split(':')[0],
      });
      throw new IncidentResponsePolicyError('CONFLICT');
    }
    const policy = await tx.incidentClassificationPolicy.create({
      data: {
        scopeKey: input.scopeKey,
        version: input.expectedVersion + 1,
        inheritWorkspace: false,
        derivePriorityFromUrgency: priorityFallbackMode === 'ENABLED',
        priorityFallbackMode,
        createdById: permissions.id,
        rules: {
          create: input.rules.map(rule => ({
            matchType: 'ALERT_SEVERITY',
            matchValue: rule.matchValue,
            priorityMode: rule.priorityMode,
            priority: rule.priority,
            urgencyMode: rule.urgencyMode,
            urgency: rule.urgency,
            label: `${rule.matchValue} alert`,
          })),
        },
      },
      include: { rules: true },
    });
    const sealed = await tx.incidentClassificationPolicy.update({
      where: { id: policy.id },
      data: { sealedAt: new Date() },
      include: { rules: true },
    });
    await emitAuditEvent(
      {
        action: 'incident_classification.policy.version_created',
        source,
        target: { type: 'SYSTEM_CONFIG', id: input.scopeKey },
        actor: { type: 'USER', id: permissions.id },
        metadata: {
          previousPolicyId: previous?.id ?? null,
          newPolicyId: sealed.id,
          version: sealed.version,
          derivePriorityFromUrgency: sealed.derivePriorityFromUrgency,
          priorityFallbackMode: sealed.priorityFallbackMode,
          rules: sealed.rules.map(rule => ({
            matchValue: rule.matchValue,
            priorityMode: rule.priorityMode,
            priority: rule.priority,
            urgencyMode: rule.urgencyMode,
            urgency: rule.urgency,
          })),
          futureIncidentsOnly: true,
          operation: source,
        },
      },
      tx
    );
    return sealed;
  });

  for (const path of ['/settings/incident-sla', '/settings', '/services', '/audit'])
    revalidatePath(path);
  return result;
}
