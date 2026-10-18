'use server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { getAutomationSettings } from '@/lib/automation/settings';
import { AppError } from '@/lib/errors/app-error';

const RETENTION_MESSAGE = 'Enter a whole number of days from 1 to 3650.';
const schema = z
  .object({
    automationEnabled: z.boolean({ message: 'Choose whether automation is on or off.' }),
    automationTraceRetentionDays: z
      .number({ message: RETENTION_MESSAGE })
      .int(RETENTION_MESSAGE)
      .min(1, RETENTION_MESSAGE)
      .max(3650, RETENTION_MESSAGE),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export type AutomationSettingsValues = {
  automationEnabled: boolean;
  automationTraceRetentionDays: number;
  automationSettingsRevision: number;
};
export type AutomationSettingsErrorCode =
  | 'CONFLICT'
  | 'ACTIVE_SERVICES'
  | 'VALIDATION'
  | 'FORBIDDEN';
export type SaveAutomationSettingsResult =
  | { ok: true; settings: AutomationSettingsValues }
  | {
      ok: false;
      code: AutomationSettingsErrorCode;
      message: string;
      fieldErrors?: Partial<Record<'automationEnabled' | 'automationTraceRetentionDays', string>>;
    };

const CONFLICT_MESSAGE =
  'Another administrator changed these settings. Reload to see the latest values, then save again.';
const ACTIVE_SERVICES_MESSAGE =
  'Services are already configured SHADOW or LIVE. Save global OFF to reset their modes before enabling; then activate services individually.';

class SettingsRejection extends Error {
  constructor(readonly code: 'CONFLICT' | 'ACTIVE_SERVICES') {
    super(code);
  }
}

// Expected failures are returned because Next.js masks thrown Server Action messages in production.
export async function saveAutomationSettings(
  input: unknown
): Promise<SaveAutomationSettingsResult> {
  let actor: { id: string };
  try {
    actor = await assertAdmin();
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === 'AUTHORIZATION_DENIED' || error.code === 'AUTHENTICATION_REQUIRED')
    )
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Administrator access is required to change automation settings.',
      };
    throw error;
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    const issueFor = (field: string) =>
      result.error.issues.find(issue => issue.path[0] === field)?.message;
    const fieldErrors: Partial<
      Record<'automationEnabled' | 'automationTraceRetentionDays', string>
    > = {};
    const enabledError = issueFor('automationEnabled');
    const retentionError = issueFor('automationTraceRetentionDays');
    if (enabledError) fieldErrors.automationEnabled = enabledError;
    if (retentionError) fieldErrors.automationTraceRetentionDays = retentionError;
    return {
      ok: false,
      code: 'VALIDATION',
      message: Object.keys(fieldErrors).length
        ? 'Check the highlighted settings and try again.'
        : 'These settings could not be saved. Reload this page and try again.',
      fieldErrors,
    };
  }
  const parsed = result.data;
  try {
    const settings = await persist(parsed, actor);
    revalidatePath('/settings/system');
    return { ok: true, settings };
  } catch (error) {
    if (!(error instanceof SettingsRejection)) throw error;
    return error.code === 'CONFLICT'
      ? { ok: false, code: 'CONFLICT', message: CONFLICT_MESSAGE }
      : { ok: false, code: 'ACTIVE_SERVICES', message: ACTIVE_SERVICES_MESSAGE };
  }
}

function persist(parsed: z.infer<typeof schema>, actor: { id: string }) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('automation-system-settings', 0))`;
    const previous = await getAutomationSettings(tx);
    if (previous.automationSettingsRevision !== parsed.expectedRevision)
      throw new SettingsRejection('CONFLICT');
    if (
      parsed.automationEnabled &&
      !previous.automationEnabled &&
      (await tx.serviceAutomationConfig.count({ where: { mode: { not: 'DISABLED' } } }))
    )
      throw new SettingsRejection('ACTIVE_SERVICES');
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
}

export async function readAutomationPrivacyCleanupStatus() {
  await assertAdmin();
  return getAutomationPrivacyCleanupStatus();
}

export async function retryAutomationPrivacyCleanupAction() {
  const actor = await assertAdmin();
  return retryAutomationPrivacyCleanup(actor.id);
}
