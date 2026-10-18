'use server';
import {
  getAutomationPrivacyCleanupStatus,
  retryAutomationPrivacyCleanup,
} from '@/lib/automation/privacy-cleanup';
import { assertAdmin } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import { updateAutomationSettings } from '@/lib/automation/settings-command';

export async function saveAutomationSettings(input: unknown) {
  const actor = await assertAdmin();
  const settings = await updateAutomationSettings(input, { actorId: actor.id, source: 'UI' });
  revalidatePath('/settings/system');
  return settings;
}

export async function readAutomationPrivacyCleanupStatus() {
  await assertAdmin();
  return getAutomationPrivacyCleanupStatus();
}

export async function retryAutomationPrivacyCleanupAction() {
  const actor = await assertAdmin();
  return retryAutomationPrivacyCleanup(actor.id);
}
