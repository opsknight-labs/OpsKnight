'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { logAudit } from '@/lib/audit';
import { setWeeklyDigestEnabled, setWeeklyDigestOptOut } from '@/lib/analytics/digest';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';

const enabledSchema = z.boolean();

/** The signed-in user's own choice; anyone can opt themselves in or out. */
export async function setMyWeeklyDigest(enabled: boolean) {
  const value = enabledSchema.parse(enabled);
  const user = await getCurrentUser();
  await setWeeklyDigestOptOut(user.id, !value);
  revalidatePath('/settings/profile');
  return { success: true };
}

/** Workspace switch for the default summary; admins only, audited. */
export async function setWorkspaceWeeklyDigest(enabled: boolean) {
  const value = enabledSchema.parse(enabled);
  const permissions = await getUserPermissions();
  if (!permissions.isAdmin) throw new Error('Only administrators can change this setting.');
  const user = await getCurrentUser();
  await setWeeklyDigestEnabled(value, user.id);
  await logAudit({
    action: value ? 'analytics.weekly_digest.enabled' : 'analytics.weekly_digest.disabled',
    entityType: 'SYSTEM_CONFIG',
    entityId: 'analytics_weekly_digest',
    actorId: user.id,
    newValue: { enabled: value },
  });
  revalidatePath('/settings/notifications');
  return { success: true };
}
