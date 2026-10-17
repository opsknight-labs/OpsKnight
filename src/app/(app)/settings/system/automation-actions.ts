'use server';
import { assertAdmin } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import { updateAutomationSettings } from '@/lib/automation/settings-command';

export async function saveAutomationSettings(input: unknown) {
  const actor = await assertAdmin();
  const settings = await updateAutomationSettings(input, { actorId: actor.id, source: 'UI' });
  revalidatePath('/settings/system');
  return settings;
}
