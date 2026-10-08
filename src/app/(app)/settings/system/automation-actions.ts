'use server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { getAutomationSettings } from '@/lib/automation/settings';
const schema = z
  .object({
    automationEnabled: z.boolean(),
    automationTraceRetentionDays: z.number().int().min(1).max(3650),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export async function saveAutomationSettings(input: unknown) {
  const actor = await assertAdmin();
  const parsed = schema.parse(input);
  const settings = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('automation-system-settings', 0))`;
    const previous = await getAutomationSettings(tx);
    if (previous.automationSettingsRevision !== parsed.expectedRevision)
      throw new Error('Automation settings changed. Reload this page before saving.');
    if (parsed.automationEnabled && !previous.automationEnabled && await tx.serviceAutomationConfig.count({ where: { mode: { not: 'DISABLED' } } }))
      throw new Error('Services are already configured SHADOW or LIVE. Save global OFF to reset their modes before enabling; then activate services individually.');
    // OFF is an emergency stop and resets operational modes. Enabling again
    // cannot surprise-activate previously LIVE services behind the switch.
    if (!parsed.automationEnabled)
      await tx.serviceAutomationConfig.updateMany({
        where: { mode: { not: 'DISABLED' } },
        data: { mode: 'DISABLED', updatedBy: actor.id },
      });
    const next = await tx.systemSettings.upsert({
      where: { id: 'default' },
      create: {
        automationEnabled: parsed.automationEnabled,
        automationTraceRetentionDays: parsed.automationTraceRetentionDays,
        automationSettingsRevision: 1,
      },
      update: {
        automationEnabled: parsed.automationEnabled,
        automationTraceRetentionDays: parsed.automationTraceRetentionDays,
        automationSettingsRevision: { increment: 1 },
      },
      select: {
        automationEnabled: true,
        automationTraceRetentionDays: true,
        automationSettingsRevision: true,
      },
    });
    await logAudit(
      {
        action: 'automation.settings.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'system',
        actorId: actor.id,
        oldValue: previous,
        newValue: next,
      },
      tx
    );
    return next;
  });
  revalidatePath('/settings/system');
  return settings;
}
