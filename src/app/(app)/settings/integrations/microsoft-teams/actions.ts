'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
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

  const clientIdRaw = (formData.get('clientId') as string | null)?.trim() ?? '';
  const clientSecretRaw = (formData.get('clientSecret') as string | null) ?? '';
  const tenantIdRaw = (formData.get('tenantId') as string | null)?.trim() || null;
  const tenantModeRaw = (formData.get('tenantMode') as string | null)?.trim() ?? 'SINGLE';
  const enabledValue = formData.get('enabled');

  // Strict validation — Zod is required by AGENTS.md §4 for every Server Action.
  const microsoftTeamsConfigSchema = z.object({
    clientId: z.string().trim().uuid('Client ID must be a valid Azure Application (client) ID (GUID).'),
    tenantId: z.string().trim().uuid('Tenant ID must be a valid Azure tenant GUID.').nullable(),
    tenantMode: z.enum(['SINGLE', 'MULTI']),
    enabledValue: z.string().nullable().optional(),
  });
  const existingEarly = await (prisma as unknown as Record<string, unknown> & { microsoftTeamsConfig: { findFirst: (a: unknown) => Promise<{ id: string; clientSecret: string; tenantId: string | null; clientId: string } | null> } }).microsoftTeamsConfig?.findFirst?.({ orderBy: { updatedAt: 'desc' } } as unknown as never) as
    | { id: string; clientSecret: string; clientId: string }
    | null
    | undefined;
  // Allow rotating secret without re-entering clientId: reuse existing clientId when present and input is empty.
  const resolvedClientId = clientIdRaw || (existingEarly as unknown as { clientId?: string } | null)?.clientId || '';
  const parsed = microsoftTeamsConfigSchema.safeParse({
    clientId: resolvedClientId,
    tenantId: tenantIdRaw,
    tenantMode: tenantModeRaw === 'MULTI' ? 'MULTI' : 'SINGLE',
    enabledValue: enabledValue as string | null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid Teams configuration.' };
  }
  const { tenantId } = parsed.data;
  const tenantMode = parsed.data.tenantMode;
  const enabled = enabledValue === 'on' || enabledValue === 'true' || enabledValue === null;
  const effectiveClientId = parsed.data.clientId;
  const existing = existingEarly;

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
