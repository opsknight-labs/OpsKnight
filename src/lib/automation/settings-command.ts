import { clearObservationJobPreviews } from './observation-payload-privacy';
import 'server-only';
import { z } from 'zod';
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
      throw new Error(
        'Services are already configured SHADOW or LIVE. Save global OFF to reset their modes before enabling; then activate services individually.'
      );
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
    if (!storePreviews) {
      await tx.automationContextObservation.updateMany({
        where: { rawValuePreview: { not: '' } },
        data: { rawValuePreview: '' },
      });
      await clearObservationJobPreviews(tx);
    }
    const next = await tx.systemSettings.upsert({
      where: { id: 'default' },
      create: {
        automationEnabled: parsed.automationEnabled,
        automationTraceRetentionDays: parsed.automationTraceRetentionDays,
        automationStoreObservationPreviews: storePreviews,
        automationSettingsRevision: 1,
      },
      update: {
        automationEnabled: parsed.automationEnabled,
        automationTraceRetentionDays: parsed.automationTraceRetentionDays,
        automationStoreObservationPreviews: storePreviews,
        automationSettingsRevision: { increment: 1 },
      },
      select: {
        automationEnabled: true,
        automationTraceRetentionDays: true,
        automationStoreObservationPreviews: true,
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
    return next;
  };
  return externalTx ? run(externalTx) : prisma.$transaction(run);
}
