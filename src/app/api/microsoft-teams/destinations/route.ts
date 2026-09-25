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

const patchSchema = z
  .object({
    serviceId: z.string().trim().min(1).max(191),
    destinationId: z.string().trim().min(1).max(191),
    interactiveEnabled: z.boolean().optional(),
    warRoomEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(data => data.interactiveEnabled !== undefined || data.warRoomEnabled !== undefined, {
    message:
      'At least one capability setting (interactiveEnabled or warRoomEnabled) must be provided.',
  });

export async function PATCH(request: NextRequest) {
  try {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: parsed.error.issues[0]?.message ?? 'Invalid destination settings.',
        })
      );
    await assertCanModifyService(parsed.data.serviceId);

    const updateData: { interactiveEnabled?: boolean; warRoomEnabled?: boolean } = {};
    if (parsed.data.interactiveEnabled !== undefined) {
      updateData.interactiveEnabled = parsed.data.interactiveEnabled;
    }
    if (parsed.data.warRoomEnabled !== undefined) {
      updateData.warRoomEnabled = parsed.data.warRoomEnabled;
    }

    const updated = await prisma.$transaction(async tx => {
      const res = await tx.microsoftTeamsDestination.updateMany({
        where: {
          id: parsed.data.destinationId,
          serviceId: parsed.data.serviceId,
          enabled: true,
          installation: { enabled: true },
        },
        data: updateData,
      });

      // If enabling warRoom on this destination, disable on other destinations for this service to keep war rooms 1-to-1
      if (parsed.data.warRoomEnabled === true && res.count > 0) {
        await tx.microsoftTeamsDestination.updateMany({
          where: {
            serviceId: parsed.data.serviceId,
            id: { not: parsed.data.destinationId },
            enabled: true,
          },
          data: { warRoomEnabled: false },
        });
      }

      return res;
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
    return jsonError('Failed to update Teams destination settings', 500);
  }
}

/**
 * GET  /api/microsoft-teams/destinations?serviceId=... → current mappings
 * POST { serviceId, tenantId, teamId, channelId, channelName?, teamName? } → upsert destination (up to 3)
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
    // Immutable identity: return only enabled rows (tombstoned history is preserved but not routable)
    const destinations = await (
      prisma as unknown as {
        microsoftTeamsDestination: {
          findMany: (a: unknown) => Promise<
            Array<{
              id: string;
              tenantId: string;
              teamId: string;
              channelId: string;
              channelName: string | null;
              teamName: string | null;
              enabled: boolean;
              interactiveEnabled: boolean;
              warRoomEnabled: boolean;
              createdAt: Date;
            }>
          >;
        };
      }
    ).microsoftTeamsDestination.findMany({
      where: { serviceId: serviceId.trim(), enabled: true },
      orderBy: { createdAt: 'asc' },
    } as never);
    return jsonOk({
      destinations,
      destination: destinations[0] ?? null,
    });
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
        const existingDest = await (
          prisma as unknown as {
            microsoftTeamsDestination: {
              findFirst: (a: unknown) => Promise<{ tenantId: string } | null>;
            };
          }
        ).microsoftTeamsDestination.findFirst({
          where: { serviceId, enabled: true },
          select: { tenantId: true },
        } as never);
        if (existingDest?.tenantId) {
          tenantId = existingDest.tenantId;
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

    // Phase 2: verified installation chain — target Team requires an enabled bot installation
    const installation = await prismaAny.microsoftTeamsInstallation.findFirst({
      where: { tenantId, teamId, enabled: true },
    });
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

    // Allow up to 3 active destinations per service.
    // Immutable identity (tenantId, teamId, channelId) per row.
    // Same-tuple re-save refreshes metadata; tombstoned tuple is revived;
    // fresh tuple creates new row up to 3 active channels limit.
    const dest = await prisma.$transaction(async tx => {
      const txAny = tx as unknown as typeof prismaAny & {
        service: {
          findUnique: (a: unknown) => Promise<{ serviceNotificationChannels: string[] } | null>;
          update: (a: unknown) => Promise<unknown>;
        };
        microsoftTeamsDestination: {
          count: (a: unknown) => Promise<number>;
          findFirst: (a: unknown) => Promise<{
            id: string;
            tenantId: string;
            teamId: string;
            channelId: string;
            enabled: boolean;
            warRoomEnabled: boolean;
          } | null>;
          create: (a: unknown) => Promise<{ id: string }>;
          update: (a: unknown) => Promise<{ id: string }>;
          updateMany: (a: unknown) => Promise<{ count: number }>;
        };
      };

      const existingTuple = await txAny.microsoftTeamsDestination.findFirst({
        where: { serviceId, tenantId, teamId, channelId },
      } as never);

      if (existingTuple && existingTuple.enabled) {
        // Idempotent metadata refresh — same immutable identity, same id
        const row = await txAny.microsoftTeamsDestination.update({
          where: { id: existingTuple.id },
          data: {
            channelName: channelName ?? null,
            teamName: teamName ?? null,
            installationId: installation.id,
            ...(interactiveEnabled !== undefined ? { interactiveEnabled } : {}),
            ...(warRoomEnabled !== undefined ? { warRoomEnabled } : {}),
            updatedBy: actorId,
          },
        } as never);

        if (warRoomEnabled === true) {
          await txAny.microsoftTeamsDestination.updateMany({
            where: {
              serviceId,
              id: { not: existingTuple.id },
              enabled: true,
            },
            data: { warRoomEnabled: false },
          });
        }
        return row;
      }

      const activeCount = await txAny.microsoftTeamsDestination.count({
        where: { serviceId, enabled: true },
      } as never);

      if (activeCount >= 3) {
        throw new AppError({
          code: 'VALIDATION_FAILED',
          userMessage:
            'A maximum of 3 Teams channels can be linked to a service. Unlink a channel before adding a new one.',
        });
      }

      // Default warRoomEnabled: true only for the first destination linked to the service,
      // keeping war rooms 1-to-1 per incident while dispatching cards to all linked channels.
      const shouldEnableWarRoom = warRoomEnabled !== undefined ? warRoomEnabled : activeCount === 0;

      let row: { id: string };
      if (existingTuple && !existingTuple.enabled) {
        // Revive tombstoned tuple so past ledger history for this channel is preserved
        row = await txAny.microsoftTeamsDestination.update({
          where: { id: existingTuple.id },
          data: {
            channelName: channelName ?? null,
            teamName: teamName ?? null,
            installationId: installation.id,
            enabled: true,
            ...(interactiveEnabled !== undefined ? { interactiveEnabled } : {}),
            warRoomEnabled: shouldEnableWarRoom,
            updatedBy: actorId,
          },
        } as never);
      } else {
        // Fresh tuple creates a new immutable row
        row = await txAny.microsoftTeamsDestination.create({
          data: {
            serviceId,
            tenantId,
            teamId,
            channelId,
            channelName: channelName ?? null,
            teamName: teamName ?? null,
            installationId: installation.id,
            enabled: true,
            interactiveEnabled: interactiveEnabled ?? false,
            warRoomEnabled: shouldEnableWarRoom,
            updatedBy: actorId,
          },
        } as never);
      }

      if (shouldEnableWarRoom) {
        await txAny.microsoftTeamsDestination.updateMany({
          where: {
            serviceId,
            id: { not: row.id },
            enabled: true,
          },
          data: { warRoomEnabled: false },
        });
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
          findFirst: (a: unknown) => Promise<{ id: string; warRoomEnabled: boolean } | null>;
          findMany: (a: unknown) => Promise<Array<{ id: string; warRoomEnabled: boolean }>>;
          update: (a: unknown) => Promise<unknown>;
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
        select: { id: true, warRoomEnabled: true },
      } as never);
      const destinationIds = destinations.map(destination => destination.id);
      const hadWarRoomEnabled = destinations.some(d => d.warRoomEnabled);

      await txAny.microsoftTeamsDestination.updateMany({
        where,
        data: { enabled: false, interactiveEnabled: false, warRoomEnabled: false },
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
      } else if (hadWarRoomEnabled) {
        // If unlinked destination was the primary war room destination, promote oldest remaining destination
        const activeWarRoom = await txAny.microsoftTeamsDestination.findFirst({
          where: { serviceId: sid, enabled: true, warRoomEnabled: true },
        } as never);
        if (!activeWarRoom) {
          const nextPrimary = await txAny.microsoftTeamsDestination.findFirst({
            where: { serviceId: sid, enabled: true },
            orderBy: { createdAt: 'asc' },
          } as never);
          if (nextPrimary) {
            await txAny.microsoftTeamsDestination.update({
              where: { id: nextPrimary.id },
              data: { warRoomEnabled: true },
            } as never);
          }
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
