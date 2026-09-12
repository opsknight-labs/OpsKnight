'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { encrypt, decrypt } from '@/lib/encryption';

/**
 * Console-UI only Teams app credentials. No .env secret.
 * `clientSecret` is AES-256-GCM encrypted at rest and never logged.
 */
export async function saveMicrosoftTeamsConfig(
  formData: FormData
): Promise<{ error?: string } | undefined> {
  try {
    await assertAdmin();
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.' };
  }

  const clientId = (formData.get('clientId') as string | null)?.trim() ?? '';
  const clientSecretRaw = (formData.get('clientSecret') as string | null) ?? '';
  const tenantId = (formData.get('tenantId') as string | null)?.trim() || null;
  const tenantModeRaw = (formData.get('tenantMode') as string | null)?.trim() ?? 'SINGLE';
  const tenantMode = tenantModeRaw === 'MULTI' ? 'MULTI' : 'SINGLE';
  const enabledValue = formData.get('enabled');
  const enabled = enabledValue === 'on' || enabledValue === 'true' || enabledValue === null;

  const existing = await (prisma as unknown as Record<string, unknown> & { microsoftTeamsConfig: { findFirst: (a: unknown) => Promise<{ id: string; clientSecret: string; tenantId: string | null; clientId: string } | null> } }).microsoftTeamsConfig?.findFirst?.({ orderBy: { updatedAt: 'desc' } } as unknown as never) as
    | { id: string; clientSecret: string; clientId: string }
    | null
    | undefined;

  // Allow rotating secret without re-entering clientId when config already exists
  let effectiveClientId = clientId || (existing as unknown as { clientId?: string } | null)?.clientId;
  if (!effectiveClientId) {
    return { error: 'Client ID (Azure Application ID) is required.' };
  }
  // Basic GUID shape check for Azure app id
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(effectiveClientId)) {
    return { error: 'Client ID must be a valid Azure Application (client) ID (GUID).' };
  }

  let encryptedSecret: string | undefined = (existing as unknown as { clientSecret?: string } | null)?.clientSecret;
  const trimmedSecret = clientSecretRaw.trim();
  const isPlaceholder = trimmedSecret === '********' || trimmedSecret === '';
  if (!isPlaceholder && trimmedSecret) {
    if (trimmedSecret.length < 8) return { error: 'Client Secret is too short.' };
    encryptedSecret = await encrypt(trimmedSecret);
  } else if (!existing) {
    return { error: 'Client Secret is required for new configuration.' };
  }

  // Verify we can decrypt whatever we will store (catch key misconfig early)
  try {
    await decrypt(encryptedSecret!);
  } catch {
    return { error: 'Failed to encrypt Client Secret. Check ENCRYPTION_KEYS configuration.' };
  }

  const user = await getCurrentUser();
  const actorId = user.id;

  const prismaAny = prisma as unknown as {
    microsoftTeamsConfig: {
      upsert: (args: unknown) => Promise<unknown>;
    };
  };
  const existingId = (existing as unknown as { id?: string } | null)?.id || 'default';
  await prismaAny.microsoftTeamsConfig.upsert({
    where: { id: existingId },
    create: {
      id: 'default',
      clientId: effectiveClientId,
      clientSecret: encryptedSecret!,
      tenantId: tenantId || null,
      tenantMode,
      enabled: enabledValue ? enabled : true,
      updatedBy: actorId,
    },
    update: {
      clientId: effectiveClientId,
      ...(encryptedSecret ? { clientSecret: encryptedSecret } : {}),
      tenantId: tenantId || null,
      tenantMode,
      ...(enabledValue ? { enabled } : {}),
      updatedBy: actorId,
    },
  } as unknown as never);

  await logAudit({
    action: 'microsoftTeams.config.updated',
    entityType: 'USER',
    entityId: user.id,
    actorId,
    details: {
      tenantMode,
      tenantId: tenantId ? `${tenantId.slice(0, 8)}...` : null,
      clientId: effectiveClientId.slice(0, 8) + '...',
      enabled,
    },
  });

  revalidatePath('/settings');
  revalidatePath('/settings/integrations/microsoft-teams');
  return undefined;
}
