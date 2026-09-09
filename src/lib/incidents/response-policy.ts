import 'server-only';
import type { IncidentUrgency, Prisma } from '@prisma/client';
import { z } from 'zod';
import { resolveNewIncidentSlaContract } from '@/lib/incident-sla/contract';
import { resolveIncidentClassification, type AlertSeverity } from './classification';
import { resolveSupportHours } from './support-hours';
import { resolveIncidentEngagement } from './engagement';

export const responsePolicyPreviewSchema = z
  .object({
    serviceId: z.string().min(1).max(191),
    integrationId: z.string().min(1).max(191).nullable().optional(),
    severity: z.enum(['critical', 'error', 'warning', 'info']),
    explicitPriority: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']).nullable().optional(),
    explicitUrgency: z.enum(['HIGH', 'MEDIUM', 'LOW']).nullable().optional(),
    at: z.coerce.date().optional(),
  })
  .strict();

/** Composes the exact production resolvers; preview has no parallel policy algorithm. */
export async function explainIncidentResponsePolicy(
  tx: Prisma.TransactionClient,
  rawInput: z.input<typeof responsePolicyPreviewSchema>
) {
  const input = responsePolicyPreviewSchema.parse(rawInput);
  const now = input.at ?? new Date();
  if (input.integrationId) {
    const trusted = await tx.integration.findFirst({
      where: { id: input.integrationId, serviceId: input.serviceId, enabled: true },
      select: { id: true },
    });
    if (!trusted) throw new Error('Integration is not enabled for the selected service.');
  }
  const classification = await resolveIncidentClassification(tx, {
    serviceId: input.serviceId,
    integrationId: input.integrationId,
    explicitPriority: input.explicitPriority,
    explicitUrgency: input.explicitUrgency as IncidentUrgency | null | undefined,
    alertSeverity: input.severity as AlertSeverity,
  });
  const [sla, supportHours] = await Promise.all([
    resolveNewIncidentSlaContract(tx, {
      serviceId: input.serviceId,
      priority: classification.priority,
      now,
    }),
    resolveSupportHours(tx, { serviceId: input.serviceId, at: now }),
  ]);
  return {
    normalizedSeverity: input.severity,
    priority: { value: classification.priority, ...classification.priorityProvenance },
    urgency: { value: classification.urgency, ...classification.urgencyProvenance },
    sla,
    supportHours,
    engagement: resolveIncidentEngagement({ urgency: classification.urgency, supportHours, now }),
  };
}

export async function getClassificationPolicyHistory(
  tx: Prisma.TransactionClient,
  scopeKey: string,
  options: { beforeVersion?: number; limit?: number } = {}
) {
  return tx.incidentClassificationPolicy.findMany({
    where: {
      scopeKey,
      sealedAt: { not: null },
      ...(options.beforeVersion ? { version: { lt: options.beforeVersion } } : {}),
    },
    orderBy: { version: 'desc' },
    take: Math.min(100, Math.max(1, options.limit ?? 25)),
    include: { rules: { orderBy: { matchValue: 'asc' } } },
  });
}

export function diffClassificationPolicies(
  from: Prisma.IncidentClassificationPolicyGetPayload<{ include: { rules: true } }>,
  to: Prisma.IncidentClassificationPolicyGetPayload<{ include: { rules: true } }>
) {
  const before = new Map(from.rules.map(rule => [rule.matchValue, rule]));
  return to.rules.flatMap(rule => {
    const old = before.get(rule.matchValue);
    const changes = [
      ['priority', old?.priorityMode, old?.priority, rule.priorityMode, rule.priority],
      ['urgency', old?.urgencyMode, old?.urgency, rule.urgencyMode, rule.urgency],
    ] as const;
    return changes
      .filter(
        ([, oldMode, oldValue, newMode, newValue]) => oldMode !== newMode || oldValue !== newValue
      )
      .map(([field, oldMode, oldValue, newMode, newValue]) => ({
        severity: rule.matchValue,
        field,
        from: { mode: oldMode ?? null, value: oldValue ?? null },
        to: { mode: newMode, value: newValue ?? null },
      }));
  });
}
