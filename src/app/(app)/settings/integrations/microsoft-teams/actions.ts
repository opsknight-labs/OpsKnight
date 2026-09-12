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

  const existingId = (existing as unknown as { id?: string } | null)?.id || 'default';
  const priorClientId = (existing as unknown as { clientId?: string } | null)?.clientId ?? null;
  const priorTenantId = (existing as unknown as { tenantId?: string | null } | null)?.tenantId ?? null;
  const priorTenantMode = (existing as unknown as { tenantMode?: string } | null)?.tenantMode ?? null;
  const clientIdChanged = priorClientId != null && priorClientId !== effectiveClientId;
  const tenantChanged = priorTenantId !== (tenantId || null) || priorTenantMode !== tenantMode;

  await prisma.$transaction(async tx => {
    const txAny = tx as unknown as {
      microsoftTeamsConfig: { upsert: (a: unknown) => Promise<unknown> };
      microsoftTeamsInstallation: { findMany: (a: unknown) => Promise<Array<{ id: string }>>; updateMany: (a: unknown) => Promise<unknown> };
      microsoftTeamsDestination: { updateMany: (a: unknown) => Promise<unknown> };
    };
    await txAny.microsoftTeamsConfig.upsert({
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

    // Config identity change invalidates prior installations/destinations + queued deliveries.
    // A stale destinations row with an old tenantId/Graph token would silently fail or mis-deliver.
    if ((clientIdChanged || tenantChanged) && existing) {
      try {
        const allInsts = await txAny.microsoftTeamsInstallation.findMany({ select: { id: true } } as never);
        const instIds = allInsts.map(r => r.id);
        if (instIds.length > 0) {
          await txAny.microsoftTeamsInstallation.updateMany({ where: { id: { in: instIds } }, data: { enabled: false } });
        }
        await (tx as unknown as { microsoftTeamsDestination: { updateMany: (a: unknown) => Promise<unknown> } }).microsoftTeamsDestination.updateMany({
          where: {},
          data: { enabled: false },
        });
        const pendingOps = await (tx as unknown as { externalOperation: { findMany: (a: unknown) => Promise<Array<{ id: string }>> } }).externalOperation.findMany({
          where: { provider: 'MICROSOFT_TEAMS' as never, status: { in: ['PENDING', 'AMBIGUOUS', 'PROCESSING'] } },
          select: { id: true },
        } as never);
        if (pendingOps.length > 0) {
          const opIds = pendingOps.map(o => o.id);
          await (tx as unknown as { externalOperation: { updateMany: (a: unknown) => Promise<unknown> } }).externalOperation.updateMany({
            where: { id: { in: opIds } },
            data: { status: 'FAILED', lastError: 'Microsoft Teams configuration changed — delivery revoked.', leaseToken: null, leaseExpiresAt: null, nextAttemptAt: new Date() },
          });
        }
        const jobs = await (tx as unknown as { backgroundJob: { findMany: (a: unknown) => Promise<Array<{ id: string; payload: unknown }>> } }).backgroundJob.findMany({
          where: { type: 'EXTERNAL_OPERATION', status: { in: ['PENDING', 'PROCESSING'] } },
          select: { id: true, payload: true },
        } as never);
        const pendingOpIds = new Set(pendingOps.map(o => o.id));
        const jobIdsToCancel: string[] = [];
        for (const job of jobs) {
          const opId = (job.payload as Record<string, unknown> | null)?.operationId;
          if (typeof opId === 'string' && pendingOpIds.has(opId)) jobIdsToCancel.push(job.id);
        }
        if (jobIdsToCancel.length > 0) {
          await (tx as unknown as { backgroundJob: { updateMany: (a: unknown) => Promise<unknown> } }).backgroundJob.updateMany({
            where: { id: { in: jobIdsToCancel } },
            data: { status: 'CANCELLED', error: 'Teams config changed' },
          });
        }
      } catch (e) {
        // Revocation is best-effort inside the transaction — do not roll back the config save.
        const { logger } = await import('@/lib/logger');
        logger.warn('[MicrosoftTeams] Config-change revocation failed', { error: (e as Error).message });
      }
    }
  });

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
      clientIdChanged,
      tenantChanged,
    },
  });

  revalidatePath('/settings');
  revalidatePath('/settings/integrations/microsoft-teams');
  return undefined;
}
