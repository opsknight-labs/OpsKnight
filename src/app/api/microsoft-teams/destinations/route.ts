import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertCanModifyService } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import prisma from '@/lib/prisma';
import { getMicrosoftTeamsConfig } from '@/lib/microsoft-teams/auth';

const upsertSchema = z.object({
  serviceId: z.string().trim().min(1).max(191),
  tenantId: z.string().trim().min(1).max(191).optional(),
  teamId: z.string().trim().min(1).max(1_024),
  channelId: z.string().trim().min(1).max(1_024),
  channelName: z.string().trim().max(255).nullable().optional(),
  teamName: z.string().trim().max(255).nullable().optional(),
});

const deleteSchema = z.object({
  serviceId: z.string().trim().min(1).max(191),
  destinationId: z.string().trim().min(1).max(191).optional(),
});

/**
 * GET  /api/microsoft-teams/destinations?serviceId=... → current mapping
 * POST { serviceId, tenantId, teamId, channelId, channelName?, teamName? } → upsert destination
 * DELETE ?serviceId=...[&destinationId=...] → remove mapping (soft-delete via deleteMany)
 */
export async function GET(request: NextRequest) {
  try {
    const serviceId = new URL(request.url).searchParams.get('serviceId');
    if (!serviceId?.trim()) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'serviceId is required.' }));
    await assertCanModifyService(serviceId.trim());
    const dest = await (prisma as unknown as {
      microsoftTeamsDestination: { findUnique: (a: unknown) => Promise<null | { id: string; tenantId: string; teamId: string; channelId: string; channelName: string | null; teamName: string | null; enabled: boolean }> };
    }).microsoftTeamsDestination.findUnique({ where: { serviceId: serviceId.trim() } } as never);
    return jsonOk({ destination: dest ?? null });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch (e) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: e as Error }));
    }
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: parsed.error.issues[0]?.message ?? 'Invalid request.' }));

    const { serviceId, teamId, channelId, channelName, teamName } = parsed.data;
    let tenantId = parsed.data.tenantId?.trim() || '';
    await assertCanModifyService(serviceId);

    // Must have Teams config
    const resolved = await getMicrosoftTeamsConfig();
    if (!resolved) return jsonError(new AppError({ code: 'NOTIFICATION_PROVIDER_UNAVAILABLE', userMessage: 'Microsoft Teams is not configured.' }));
    // Infer tenantId when caller omitted it.
    if (!tenantId) {
      const cfgTenant = resolved.config.tenantId?.trim();
      if (cfgTenant) {
        tenantId = cfgTenant;
      } else {
        // MULTI mode: resolve from existing installation for this team
        const probe = await (prisma as unknown as {
          microsoftTeamsInstallation: { findFirst: (a: unknown) => Promise<{ tenantId: string } | null> };
        }).microsoftTeamsInstallation.findFirst({ where: { teamId }, select: { tenantId: true } } as never);
        if (probe?.tenantId) tenantId = probe.tenantId;
        else return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'tenantId is required. Configure SINGLE tenant or install the bot to the target Team first.' }));
      }
    }

    const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } });
    if (!service) return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Service not found.' }));

    const prismaAny = prisma as unknown as {
      microsoftTeamsInstallation: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
      microsoftTeamsDestination: {
        upsert: (a: unknown) => Promise<{ id: string }>;
        findUnique: (a: unknown) => Promise<unknown>;
      };
    };

    const installation = await prismaAny.microsoftTeamsInstallation.findFirst({ where: { tenantId, teamId } });

    const currentUser = await (await import('@/lib/rbac')).getCurrentUser().catch(() => null);
    const actorId = currentUser?.id ?? null;

    const dest = await prismaAny.microsoftTeamsDestination.upsert({
      where: { serviceId },
      create: {
        serviceId,
        tenantId,
        teamId,
        channelId,
        channelName: channelName ?? null,
        teamName: teamName ?? null,
        installationId: installation?.id ?? null,
        enabled: true,
        updatedBy: actorId,
      },
      update: {
        tenantId,
        teamId,
        channelId,
        channelName: channelName ?? null,
        teamName: teamName ?? null,
        installationId: installation?.id ?? null,
        enabled: true,
        updatedBy: actorId,
      },
    } as never);

    // Also ensure serviceNotificationChannels includes MICROSOFT_TEAMS so dispatch honours the mapping.
    try {
      const svc = await prisma.service.findUnique({ where: { id: serviceId }, select: { serviceNotificationChannels: true } });
      const channels = new Set((svc?.serviceNotificationChannels ?? []) as string[]);
      if (!channels.has('MICROSOFT_TEAMS')) {
        channels.add('MICROSOFT_TEAMS');
        await prisma.service.update({ where: { id: serviceId }, data: { serviceNotificationChannels: [...channels] as never } });
      }
    } catch (e) {
      logger.warn('[MicrosoftTeams] Failed to auto-enable channel on service', { error: (e as Error).message });
    }

    await logAudit({
      action: 'microsoftTeams.destination.upserted',
      entityType: 'SERVICE',
      entityId: serviceId,
      actorId: actorId ?? serviceId,
      details: { destinationId: (dest as { id: string }).id, tenantId: tenantId.slice(0, 8) + '…', teamId: teamId.slice(0, 12) + '…', channelId: channelId.slice(0, 12) + '…' },
    });

    return jsonOk({ destination: dest });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('[MicrosoftTeams] destinations POST failed', { error: (error as Error).message });
    return jsonError('Failed to save Teams destination', 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const serviceId = url.searchParams.get('serviceId')?.trim();
    const destinationId = url.searchParams.get('destinationId')?.trim();
    const parsed = deleteSchema.safeParse({ serviceId, destinationId });
    if (!parsed.success) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: parsed.error.issues[0]?.message ?? 'Invalid request.' }));
    const sid = parsed.data.serviceId;
    await assertCanModifyService(sid);

    const prismaAny = prisma as unknown as {
      microsoftTeamsDestination: { deleteMany: (a: unknown) => Promise<{ count: number }> };
    };
    if (parsed.data.destinationId) {
      await prismaAny.microsoftTeamsDestination.deleteMany({ where: { id: parsed.data.destinationId, serviceId: sid } } as never);
    } else {
      await prismaAny.microsoftTeamsDestination.deleteMany({ where: { serviceId: sid } } as never);
    }

    const user = await (await import('@/lib/rbac')).getCurrentUser().catch(() => null);
    await logAudit({
      action: 'microsoftTeams.destination.deleted',
      entityType: 'SERVICE',
      entityId: sid,
      actorId: user?.id ?? sid,
      details: { destinationId: destinationId ?? sid },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}
