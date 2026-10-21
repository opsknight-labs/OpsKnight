'use server';
import {
  getAutomationPrivacyCleanupStatus,
  retryAutomationPrivacyCleanup,
} from '@/lib/automation/privacy-cleanup';
import { assertAdmin } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import {
  automationSettingsSchema,
  updateAutomationSettings,
} from '@/lib/automation/settings-command';
import { AppError } from '@/lib/errors';

export type SaveAutomationSettingsResult =
  | {
      ok: true;
      settings: {
        automationEnabled: boolean;
        automationTraceRetentionDays: number;
        automationSettingsRevision: number;
      };
    }
  | {
      ok: false;
      code: 'CONFLICT' | 'ACTIVE_SERVICES' | 'VALIDATION' | 'FORBIDDEN';
      message: string;
      fieldErrors?: Partial<Record<'automationEnabled' | 'automationTraceRetentionDays', string>>;
    };

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
  const parsed = automationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<
      Record<'automationEnabled' | 'automationTraceRetentionDays', string>
    > = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'automationEnabled') fieldErrors.automationEnabled = issue.message;
      if (issue.path[0] === 'automationTraceRetentionDays')
        fieldErrors.automationTraceRetentionDays = 'Enter a whole number of days from 1 to 3650.';
    }
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'Check the highlighted settings and try again.',
      fieldErrors,
    };
  }
  try {
    const settings = await updateAutomationSettings(parsed.data, {
      actorId: actor.id,
      source: 'UI',
    });
    revalidatePath('/settings/system');
    return {
      ok: true,
      settings: {
        automationEnabled: settings.automationEnabled,
        automationTraceRetentionDays: settings.automationTraceRetentionDays,
        automationSettingsRevision: settings.automationSettingsRevision,
      },
    };
  } catch (error) {
    if (error instanceof AppError && error.code === 'PRECONDITION_FAILED')
      return {
        ok: false,
        code: 'CONFLICT',
        message:
          'Another administrator changed these settings. Reload to see the latest values, then save again.',
      };
    if (error instanceof AppError && error.code === 'RESOURCE_CONFLICT')
      return {
        ok: false,
        code: 'ACTIVE_SERVICES',
        message:
          'Services are already configured SHADOW or LIVE. Save global OFF to reset their modes before enabling; then activate services individually.',
      };
    throw error;
  }
}

export async function readAutomationPrivacyCleanupStatus() {
  await assertAdmin();
  return getAutomationPrivacyCleanupStatus();
}

export async function retryAutomationPrivacyCleanupAction() {
  const actor = await assertAdmin();
  return retryAutomationPrivacyCleanup(actor.id);
}
