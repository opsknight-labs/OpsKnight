import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertCanModifyService } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import prisma from '@/lib/prisma';
import { getSlackBotToken } from '@/lib/slack';

const upsertSchema = z.object({
  serviceId: z.string().trim().min(1).max(191),
  channelId: z.string().trim().min(1).max(255),
  channelName: z.string().trim().max(255).nullable().optional(),
  isPrivate: z.boolean().optional(),
});

const deleteSchema = z.object({
  serviceId: z.string().trim().min(1).max(191),
  destinationId: z.string().trim().min(1).max(191).optional(),
});

/**
 * GET  /api/slack/destinations?serviceId=... -> list of linked active destinations
 */
export async function GET(request: NextRequest) {
  try {
    const serviceId = new URL(request.url).searchParams.get('serviceId');
    if (!serviceId?.trim()) {
      return jsonError(
        new AppError({ code: 'VALIDATION_FAILED', userMessage: 'serviceId is required.' })
      );
    }
    await assertCanModifyService(serviceId.trim());

    const destinations = await prisma.slackDestination.findMany({
      where: { serviceId: serviceId.trim(), enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    return jsonOk({
      destinations,
      destination: destinations[0] ?? null,
    });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}

/**
 * POST /api/slack/destinations -> link or update a Slack destination (max 3 per service)
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch (e) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: e as Error }));
    }

    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: parsed.error.issues[0]?.message ?? 'Invalid request.',
        })
      );
    }

    const { serviceId, channelId, channelName, isPrivate } = parsed.data;
    const currentUser = await assertCanModifyService(serviceId);
    const actorId = currentUser?.id ?? null;

    const botToken = await getSlackBotToken(serviceId);
    if (!botToken) {
      return jsonError(
        new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage: 'Slack is not configured. Connect a Slack workspace first.',
        })
      );
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        slackIntegration: true,
      },
    });

    if (!service) {
      return jsonError(
        new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Service not found.' })
      );
    }

    // Resolve workspace ID from service integration or global integration
    let workspaceId = service.slackIntegration?.workspaceId;
    let integrationId = service.slackIntegration?.id ?? null;

    if (!workspaceId) {
      const globalIntegration = await prisma.slackIntegration.findFirst({
        where: { enabled: true },
        orderBy: { createdAt: 'asc' },
      });
      if (globalIntegration) {
        workspaceId = globalIntegration.workspaceId;
        integrationId = globalIntegration.id;
      } else {
        workspaceId = service.slackWorkspaceId || 'default_workspace';
      }
    }

    const dest = await prisma.$transaction(async tx => {
      const existingTuple = await tx.slackDestination.findUnique({
        where: {
          serviceId_workspaceId_channelId: {
            serviceId,
            workspaceId,
            channelId,
          },
        },
      });

      if (existingTuple?.enabled) {
        // Already active: refresh channel metadata
        const updated = await tx.slackDestination.update({
          where: { id: existingTuple.id },
          data: {
            channelName: channelName ?? existingTuple.channelName,
            isPrivate: isPrivate !== undefined ? isPrivate : existingTuple.isPrivate,
            integrationId: integrationId ?? existingTuple.integrationId,
            updatedBy: actorId,
          },
        });
        return updated;
      }

      // Check active count limit (maximum 3 channels per service)
      const activeCount = await tx.slackDestination.count({
        where: { serviceId, enabled: true },
      });

      if (activeCount >= 3) {
        throw new AppError({
          code: 'VALIDATION_FAILED',
          userMessage:
            'A maximum of 3 Slack channels can be linked to a service. Unlink a channel before adding a new one.',
        });
      }

      let row;
      if (existingTuple && !existingTuple.enabled) {
        // Revive tombstoned tuple
        row = await tx.slackDestination.update({
          where: { id: existingTuple.id },
          data: {
            channelName: channelName ?? null,
            isPrivate: isPrivate ?? false,
            integrationId,
            enabled: true,
            updatedBy: actorId,
          },
        });
      } else {
        // Create new row
        row = await tx.slackDestination.create({
          data: {
            serviceId,
            workspaceId,
            channelId,
            channelName: channelName ?? null,
            isPrivate: isPrivate ?? false,
            integrationId,
            enabled: true,
            updatedBy: actorId,
          },
        });
      }

      // Ensure service notification channels has SLACK enabled
      const serviceChannels = service.serviceNotificationChannels || [];
      const updates: {
        serviceNotificationChannels?: typeof serviceChannels;
        slackChannel?: string;
      } = {};

      if (!serviceChannels.includes('SLACK' as never)) {
        updates.serviceNotificationChannels = [...serviceChannels, 'SLACK' as never];
      }
      // Keep legacy service.slackChannel in sync with first active channel
      if (!service.slackChannel || !serviceChannels.includes('SLACK' as never)) {
        updates.slackChannel = channelName || channelId;
      }

      if (Object.keys(updates).length > 0) {
        await tx.service.update({
          where: { id: serviceId },
          data: updates,
        });
      }

      return row;
    });

    await logAudit({
      action: 'service.slack_destination.linked',
      entityType: 'SERVICE',
      entityId: serviceId,
      actorId,
      details: {
        destinationId: dest.id,
        channelId,
        channelName,
        workspaceId,
      },
    });

    logger.info('[Slack] Linked destination to service', {
      serviceId,
      channelId,
      channelName,
      destinationId: dest.id,
    });

    return jsonOk({ destination: dest, ok: true });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('[Slack] Failed to link destination', { error });
    return jsonError('Failed to link Slack channel', 500);
  }
}

/**
 * DELETE /api/slack/destinations?serviceId=...[&destinationId=...] -> unlink destination
 */
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const serviceId = url.searchParams.get('serviceId');
    const destinationId = url.searchParams.get('destinationId') || undefined;

    const parsed = deleteSchema.safeParse({ serviceId, destinationId });
    if (!parsed.success) {
      return jsonError(
        new AppError({ code: 'VALIDATION_FAILED', userMessage: 'serviceId is required.' })
      );
    }

    const { serviceId: sid, destinationId: did } = parsed.data;
    const currentUser = await assertCanModifyService(sid);
    const actorId = currentUser?.id ?? null;

    await prisma.$transaction(async tx => {
      const where = did ? { id: did, serviceId: sid } : { serviceId: sid };

      await tx.slackDestination.updateMany({
        where,
        data: { enabled: false },
      });

      const remaining = await tx.slackDestination.findMany({
        where: { serviceId: sid, enabled: true },
        orderBy: { createdAt: 'asc' },
      });

      const svc = await tx.service.findUnique({
        where: { id: sid },
        select: { serviceNotificationChannels: true, slackWebhookUrl: true },
      });

      if (svc) {
        if (remaining.length === 0) {
          // If no destinations remaining and no webhook, remove SLACK channel
          const nextChannels = (svc.serviceNotificationChannels || []).filter(
            c => c !== ('SLACK' as never) || Boolean(svc.slackWebhookUrl?.trim())
          );
          await tx.service.update({
            where: { id: sid },
            data: {
              slackChannel: null,
              serviceNotificationChannels: nextChannels,
            },
          });
        } else {
          // Update legacy fallback to next active channel
          const primary = remaining[0];
          await tx.service.update({
            where: { id: sid },
            data: {
              slackChannel: primary.channelName || primary.channelId,
            },
          });
        }
      }
    });

    await logAudit({
      action: 'service.slack_destination.unlinked',
      entityType: 'SERVICE',
      entityId: sid,
      actorId,
      details: { destinationId: did ?? 'ALL' },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('[Slack] Failed to unlink destination', { error });
    return jsonError('Failed to unlink Slack channel', 500);
  }
}
