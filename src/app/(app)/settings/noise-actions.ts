'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';
import { notificationNoiseEnabled } from '@/lib/notification-noise/loader';

/**
 * A person's own opt-in to bundled low-urgency pages. Turning it off always works; turning it on needs
 * the Notifications area to be switched on by an administrator.
 */
export async function updateBundlePreference(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    if (typeof enabled !== 'boolean') return { success: false, error: 'Invalid value.' };
    const user = await getCurrentUser();
    if (enabled && !(await notificationNoiseEnabled())) {
      return { success: false, error: 'Bundling is not available in this workspace.' };
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { bundleLowUrgencyPages: enabled },
    });
    revalidatePath('/settings/profile');
    revalidatePath('/m/more');
    return { success: true };
  } catch {
    return { success: false, error: 'Unable to save the bundling preference.' };
  }
}
