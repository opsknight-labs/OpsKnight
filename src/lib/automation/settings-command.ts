import { randomUUID } from 'node:crypto';
import { automationReadinessPolicySchema } from './readiness-policy';
import 'server-only';
import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { getAutomationSettings } from './settings';

export const automationSettingsSchema = z
  .object({
    automationEnabled: z.boolean(),
    automationTraceRetentionDays: z.number().int().min(1).max(3650),
    automationStoreObservationPreviews: z.boolean().optional(),
    automationReadinessPolicy: automationReadinessPolicySchema.optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

type SettingsActor = { actorId: string } & (
  { source: 'UI' } | { source: 'API'; apiClientId: string }
);

/** Caller must authorize administrative settings access; audit and writes share its transaction. */
export async function updateAutomationSettings(
  input: unknown,
  context: SettingsActor,
  externalTx?: Prisma.TransactionClient
) {
  const parsed = automationSettingsSchema.parse(input);
  const run = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('automation-system-settings', 0))`;
    await tx.$queryRaw`SELECT id FROM "SystemSettings" WHERE id = 'default' FOR UPDATE`;
    const previous = await getAutomationSettings(tx);
    if (previous.automationSettingsRevision !== parsed.expectedRevision)
      throw new AppError({ code: 'PRECONDITION_FAILED' });
    if (
      parsed.automationEnabled &&
      !previous.automationEnabled &&
      (await tx.serviceAutomationConfig.count({ where: { mode: { not: 'DISABLED' } } }))
    )
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage:
          'Services are already configured SHADOW or LIVE. Save global OFF to reset their modes before enabling; then activate services individually.',
      });
    // OFF is an emergency stop and resets operational modes. Enabling again
    // cannot surprise-activate previously LIVE services behind the switch.
    if (!parsed.automationEnabled)
      await tx.serviceAutomationConfig.updateMany({
        where: { mode: { not: 'DISABLED' } },
        data: { mode: 'DISABLED', updatedBy: context.actorId },
      });
    const storePreviews =
      parsed.automationStoreObservationPreviews ??
      previous.automationStoreObservationPreviews ??
      false;
    const disablingPreviews =
      previous.automationStoreObservationPreviews === true && !storePreviews;
    if (
      disablingPreviews ||
      (!parsed.automationEnabled && previous.automationEnabled && !storePreviews)
    ) {
      // Opt-out and emergency OFF commit immediately; physical deletion is bounded and resumable.
      // Readers and writers fence previews using the committed settings while cleanup runs.
      const cleanupId = randomUUID();
      await tx.backgroundJob.create({
        data: {
          id: `AUTOMATION_PRIVACY_CLEANUP:${cleanupId}:0`,
          type: 'SCHEDULED_TASK',
          scheduledAt: new Date(),
          payload: { task: 'AUTOMATION_PRIVACY_CLEANUP', cleanupId, batch: 0 },
          maxAttempts: 10,
        },
      });
    }
    const readinessPolicy = parsed.automationReadinessPolicy ?? previous.automationReadinessPolicy;
    const next = await tx.systemSettings.upsert({
      where: { id: 'default' },
      create: {
        automationEnabled: parsed.automationEnabled,
        automationTraceRetentionDays: parsed.automationTraceRetentionDays,
        automationStoreObservationPreviews: storePreviews,
        automationReadinessPolicy: readinessPolicy,
        automationSettingsRevision: 1,
      },
      update: {
        automationEnabled: parsed.automationEnabled,
        automationTraceRetentionDays: parsed.automationTraceRetentionDays,
        automationStoreObservationPreviews: storePreviews,
        automationReadinessPolicy: readinessPolicy,
        automationSettingsRevision: { increment: 1 },
      },
      select: {
        automationEnabled: true,
        automationTraceRetentionDays: true,
        automationStoreObservationPreviews: true,
        automationReadinessPolicy: true,
        automationSettingsRevision: true,
      },
    });
    await logAudit(
      {
        action: 'automation.settings.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'system',
        actorId: context.actorId,
        source: context.source,
        details: context.source === 'API' ? { apiClientId: context.apiClientId } : undefined,
        oldValue: previous,
        newValue: next,
      },
      tx
    );
    return {
      ...next,
      automationReadinessPolicy: readinessPolicy,
      automationReadinessPolicyValid: true,
    };
  };
  return externalTx ? run(externalTx) : prisma.$transaction(run);
}
