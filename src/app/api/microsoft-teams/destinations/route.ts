import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertCanModifyService } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import prisma from '@/lib/prisma';
import { getMicrosoftTeamsConfig } from '@/lib/microsoft-teams/auth';
import {
  revokeMicrosoftTeamsOperations,
  revokeMicrosoftTeamsWarRoomProvisioning,
} from '@/lib/microsoft-teams/lifecycle';

const upsertSchema = z.object({
  serviceId: z.string().trim().min(1).max(191),
  tenantId: z.string().trim().min(1).max(191).optional(),
  teamId: z.string().trim().min(1).max(1_024),
  channelId: z.string().trim().min(1).max(1_024),
  channelName: z.string().trim().max(255).nullable().optional(),
  teamName: z.string().trim().max(255).nullable().optional(),
  interactiveEnabled: z.boolean().optional(),
  warRoomEnabled: z.boolean().optional(),
});

const deleteSchema = z.object({
  serviceId: z.string().trim().min(1).max(191),
  destinationId: z.string().trim().min(1).max(191).optional(),
});
const interactiveSchema = z
  .object({
    serviceId: z.string().trim().min(1).max(191),
    destinationId: z.string().trim().min(1).max(191),
    interactiveEnabled: z.boolean(),
  })
  .strict();

export async function PATCH(request: NextRequest) {
  try {
    const parsed = interactiveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Invalid interactive destination settings.',
        })
      );
    await assertCanModifyService(parsed.data.serviceId);
    const updated = await prisma.microsoftTeamsDestination.updateMany({
      where: {
        id: parsed.data.destinationId,
        serviceId: parsed.data.serviceId,
        enabled: true,
        installation: { enabled: true },
      },
      data: { interactiveEnabled: parsed.data.interactiveEnabled },
    });
    if (updated.count !== 1)
      return jsonError(
        new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: 'Active Teams destination not found.',
        })
      );
    return jsonOk({ ok: true });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to update Teams interactive settings', 500);
  }
}

/**
 * GET  /api/microsoft-teams/destinations?serviceId=... → current mapping
 * POST { serviceId, tenantId, teamId, channelId, channelName?, teamName? } → upsert destination
 * DELETE ?serviceId=...[&destinationId=...] → disable mapping while preserving delivery history
 */
export async function GET(request: NextRequest) {
  try {
    const serviceId = new URL(request.url).searchParams.get('serviceId');
    if (!serviceId?.trim())
      return jsonError(
        new AppError({ code: 'VALIDATION_FAILED', userMessage: 'serviceId is required.' })
      );
    await assertCanModifyService(serviceId.trim());
    // Immutable identity: return only the enabled row (tombstoned history is preserved but not routable)
    const dest = await (
      prisma as unknown as {
        microsoftTeamsDestination: {
          findFirst: (a: unknown) => Promise<null | {
            id: string;
            tenantId: string;
            teamId: string;
            channelId: string;
            channelName: string | null;
            teamName: string | null;
            enabled: boolean;
          }>;
        };
      }
    ).microsoftTeamsDestination.findFirst({
      where: { serviceId: serviceId.trim(), enabled: true },
      orderBy: { updatedAt: 'desc' },
    } as never);
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
    if (!parsed.success)
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: parsed.error.issues[0]?.message ?? 'Invalid request.',
        })
      );

    const {
      serviceId,
      teamId,
      channelId,
      channelName,
      teamName,
      interactiveEnabled,
      warRoomEnabled,
    } = parsed.data;
    let tenantId = parsed.data.tenantId?.trim() || '';
    await assertCanModifyService(serviceId);

    // Must have Teams config
    const resolved = await getMicrosoftTeamsConfig();
    if (!resolved)
      return jsonError(
        new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage: 'Microsoft Teams is not configured.',
        })
      );
    // Infer tenantId when caller omitted it.
    if (!tenantId) {
      const cfgTenant = resolved.config.tenantId?.trim();
      if (cfgTenant) {
        tenantId = cfgTenant;
      } else {
        // MULTI mode: resolve from existing installation for this team
        const probe = await (
          prisma as unknown as {
            microsoftTeamsInstallation: {
              findFirst: (a: unknown) => Promise<{ tenantId: string } | null>;
            };
          }
        ).microsoftTeamsInstallation.findFirst({
          where: { teamId },
          select: { tenantId: true },
        } as never);
        if (probe?.tenantId) tenantId = probe.tenantId;
        else
          return jsonError(
            new AppError({
              code: 'VALIDATION_FAILED',
              userMessage:
                'tenantId is required. Configure SINGLE tenant or install the bot to the target Team first.',
            })
          );
      }
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });
    if (!service)
      return jsonError(
        new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Service not found.' })
      );

    const prismaAny = prisma as unknown as {
      microsoftTeamsInstallation: {
        findFirst: (a: unknown) => Promise<{ id: string; enabled: boolean } | null>;
      };
      microsoftTeamsDestination: {
        create: (a: unknown) => Promise<{ id: string }>;
        findFirst: (a: unknown) => Promise<{
          id: string;
          tenantId: string;
          teamId: string;
          channelId: string;
          enabled: boolean;
        } | null>;
        findMany: (a: unknown) => Promise<Array<{ id: string }>>;
        findUnique: (a: unknown) => Promise<unknown>;
        update: (a: unknown) => Promise<{ id: string }>;
        updateMany: (a: unknown) => Promise<{ count: number }>;
      };
    };

    // Phase 2: verified installation chain — destination requires an enabled installation
    let installation = await prismaAny.microsoftTeamsInstallation.findFirst({
      where: { tenantId, teamId, enabled: true },
    });
    if (!installation?.id) {
      installation = await prismaAny.microsoftTeamsInstallation.findFirst({
        where: { tenantId, enabled: true },
      });
    }
    if (!installation?.id) {
      return jsonError(
        new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage:
            'Teams app is not installed to this Team. Install the bot to the target Team first, then link the destination.',
          details: { tenantId: tenantId.slice(0, 8) + '…', teamId: teamId.slice(0, 12) + '…' },
        })
      );
    }

    const currentUser = await (await import('@/lib/rbac')).getCurrentUser().catch(() => null);
    const actorId = currentUser?.id ?? null;

    // Verify channel actually belongs to the team (prevents spoofed channelId).
    // Uses Graph `GET /teams/{team}/channels` scoped to the verified installation tenant.
    type ChannelVerified = { ok: true } | { ok: false; reason: string };
    const channelVerified: ChannelVerified = await (async (): Promise<ChannelVerified> => {
      try {
        const { listMicrosoftTeamsChannelsForDiscovery } =
          await import('@/lib/microsoft-teams/client');
        const res = await listMicrosoftTeamsChannelsForDiscovery(teamId, { tenantId });
        if (res.error) {
          if (res.error === 'APP_NOT_INSTALLED') return { ok: false, reason: 'APP_NOT_INSTALLED' };
          if (res.error === 'GRAPH_TOKEN_FAILED' || res.error === 'TENANT_REQUIRED')
            return { ok: false, reason: res.error };
          return { ok: false, reason: res.error };
        }
        const found = res.channels.some(c => c.id === channelId);
        return found ? { ok: true } : { ok: false, reason: 'CHANNEL_NOT_FOUND' };
      } catch (e) {
        return { ok: false, reason: (e instanceof Error ? e.message : String(e)).slice(0, 80) };
      }
    })();
    if (!channelVerified.ok) {
      const reason = channelVerified.reason ?? 'CHANNEL_NOT_FOUND';
      if (reason === 'CHANNEL_NOT_FOUND') {
        return jsonError(
          new AppError({
            code: 'RESOURCE_NOT_FOUND',
            userMessage:
              'Channel not found in the selected Team. Pick a channel from the Teams discovery list.',
            details: { teamId: teamId.slice(0, 12) + '…', channelId: channelId.slice(0, 12) + '…' },
          })
        );
      }
      return jsonError(
        new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage: `Failed to verify Teams channel: ${reason}`,
          details: {
            teamId: teamId.slice(0, 12) + '…',
            channelId: channelId.slice(0, 12) + '…',
            reason,
          },
        })
      );
    }

    // Immutable identity (tenantId,teamId,channelId) per row: routing change tombstones the old
    // enabled row and creates a new row with a new id so ledger (ExternalOperation.destinationId,
    // MicrosoftTeamsIncidentMessage.*) stays pinned to the original D1. At most one enabled per
    // service (partial unique WHERE enabled=true). Same-tuple re-save only refreshes metadata.
    const dest = await prisma.$transaction(async tx => {
      const txAny = tx as unknown as typeof prismaAny & {
        service: {
          findUnique: (a: unknown) => Promise<{ serviceNotificationChannels: string[] } | null>;
          update: (a: unknown) => Promise<unknown>;
        };
      };
      const existing = await (
        txAny as unknown as typeof prismaAny
      ).microsoftTeamsDestination.findFirst({
        where: { serviceId, enabled: true },
        orderBy: { updatedAt: 'desc' },
      } as never);
      const tupleMatches = Boolean(
        existing &&
        (existing as unknown as { tenantId: string; teamId: string; channelId: string })
          .tenantId === tenantId &&
        (existing as unknown as { tenantId: string; teamId: string; channelId: string }).teamId ===
          teamId &&
        (existing as unknown as { tenantId: string; teamId: string; channelId: string })
          .channelId === channelId
      );
      let row: { id: string };
      if (existing && tupleMatches) {
        // Idempotent metadata refresh — same immutable identity, same id
        row = await (txAny as unknown as typeof prismaAny).microsoftTeamsDestination.update({
          where: { id: (existing as unknown as { id: string }).id },
          data: {
            channelName: channelName ?? null,
            teamName: teamName ?? null,
            installationId: installation.id,
            enabled: true,
            ...(interactiveEnabled !== undefined ? { interactiveEnabled } : {}),
            updatedBy: actorId,
          },
        } as never);
      } else {
        // Tombstone prior routing (if any) and fence its in-flight AMBIGUOUS work before introducing D2
        if (existing) {
          const oldId = (existing as unknown as { id: string }).id;
          await (txAny as unknown as typeof prismaAny).microsoftTeamsDestination.update({
            where: { id: oldId },
            data: { enabled: false },
          } as never);
          await revokeMicrosoftTeamsOperations(tx, {
            destinationIds: [oldId],
            reason: 'Microsoft Teams destination retargeted',
          });
          await revokeMicrosoftTeamsWarRoomProvisioning(tx, {
            destinationIds: [oldId],
            reason: 'Microsoft Teams destination retargeted',
          });
        }
        // Create-or-reuse the target tuple: an old tombstone for same (service,tuple) is revived (id reused
        // and ledger preserved) so already-delivered message history for that channel is not orphaned.
        // A fresh tuple creates a new immutable row.
        const tombstoned = await (
          txAny as unknown as typeof prismaAny
        ).microsoftTeamsDestination.findFirst({
          where: { serviceId, tenantId, teamId, channelId },
        } as never);
        if (tombstoned && !(tombstoned as unknown as { enabled: boolean }).enabled) {
          row = await (txAny as unknown as typeof prismaAny).microsoftTeamsDestination.update({
            where: { id: (tombstoned as unknown as { id: string }).id },
            data: {
              channelName: channelName ?? null,
              teamName: teamName ?? null,
              installationId: installation.id,
              enabled: true,
              interactiveEnabled: interactiveEnabled ?? true,
              warRoomEnabled: warRoomEnabled ?? true,
              warRoomAutoCreate: true,
              updatedBy: actorId,
            },
          } as never);
        } else if (tombstoned) {
          // Should not happen (we tombstoned the single enabled above, and tuple didn't match), but handle race
          row = await (txAny as unknown as typeof prismaAny).microsoftTeamsDestination.update({
            where: { id: (tombstoned as unknown as { id: string }).id },
            data: {
              channelName: channelName ?? null,
              teamName: teamName ?? null,
              installationId: installation.id,
              ...(interactiveEnabled !== undefined ? { interactiveEnabled } : {}),
              ...(warRoomEnabled !== undefined ? { warRoomEnabled } : {}),
              updatedBy: actorId,
            },
          } as never);
        } else {
          row = await (txAny as unknown as typeof prismaAny).microsoftTeamsDestination.create({
            data: {
              serviceId,
              tenantId,
              teamId,
              channelId,
              channelName: channelName ?? null,
              teamName: teamName ?? null,
              installationId: installation.id,
              enabled: true,
              interactiveEnabled: interactiveEnabled ?? true,
              warRoomEnabled: warRoomEnabled ?? true,
              warRoomAutoCreate: true,
              updatedBy: actorId,
            },
          } as never);
        }
      }
      const svc = await txAny.service.findUnique({
        where: { id: serviceId },
        select: { serviceNotificationChannels: true },
      });
      const channels = new Set((svc?.serviceNotificationChannels ?? []) as string[]);
      if (!channels.has('MICROSOFT_TEAMS')) {
        channels.add('MICROSOFT_TEAMS');
        await txAny.service.update({
          where: { id: serviceId },
          data: { serviceNotificationChannels: [...channels] as never },
        });
      }
      return row;
    });

    await logAudit({
      action: 'microsoftTeams.destination.upserted',
      entityType: 'SERVICE',
      entityId: serviceId,
      actorId: actorId ?? serviceId,
      details: {
        destinationId: (dest as { id: string }).id,
        tenantId: tenantId.slice(0, 8) + '…',
        teamId: teamId.slice(0, 12) + '…',
        channelId: channelId.slice(0, 12) + '…',
      },
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
    if (!parsed.success)
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: parsed.error.issues[0]?.message ?? 'Invalid request.',
        })
      );
    const sid = parsed.data.serviceId;
    await assertCanModifyService(sid);

    // Atomic tombstone: preserve destination/message identity and any AMBIGUOUS
    // delivery truth while disabling routing and cancelling safe future work.
    await prisma.$transaction(async tx => {
      const txAny = tx as unknown as {
        microsoftTeamsDestination: {
          findMany: (a: unknown) => Promise<Array<{ id: string }>>;
          updateMany: (a: unknown) => Promise<{ count: number }>;
          count: (a: unknown) => Promise<number>;
        };
        service: {
          findUnique: (a: unknown) => Promise<{ serviceNotificationChannels: string[] } | null>;
          update: (a: unknown) => Promise<unknown>;
        };
      };
      const where = parsed.data.destinationId
        ? { id: parsed.data.destinationId, serviceId: sid }
        : { serviceId: sid };
      const destinations = await txAny.microsoftTeamsDestination.findMany({
        where,
        select: { id: true },
      } as never);
      const destinationIds = destinations.map(destination => destination.id);
      await txAny.microsoftTeamsDestination.updateMany({
        where,
        data: { enabled: false, interactiveEnabled: false },
      } as never);
      await revokeMicrosoftTeamsOperations(tx, {
        destinationIds,
        reason: 'Microsoft Teams destination unlinked',
      });
      await revokeMicrosoftTeamsWarRoomProvisioning(tx, {
        destinationIds,
        reason: 'Microsoft Teams destination unlinked',
      });
      const remaining = await txAny.microsoftTeamsDestination.count({
        where: { serviceId: sid, enabled: true },
      } as never);
      if (remaining === 0) {
        const svc = await txAny.service.findUnique({
          where: { id: sid },
          select: { serviceNotificationChannels: true },
        });
        const channels = (svc?.serviceNotificationChannels ?? []) as string[];
        if (channels.includes('MICROSOFT_TEAMS')) {
          const next = channels.filter(c => c !== 'MICROSOFT_TEAMS');
          await txAny.service.update({
            where: { id: sid },
            data: { serviceNotificationChannels: next as never },
          });
        }
      }
    });

    const user = await (await import('@/lib/rbac')).getCurrentUser().catch(() => null);
    await logAudit({
      action: 'microsoftTeams.destination.disabled',
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
