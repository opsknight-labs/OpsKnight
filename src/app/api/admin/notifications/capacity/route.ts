import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getUserPermissions } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { invalidateNotificationCapacityControl } from '@/lib/notification-capacity-control';
import {
  invalidateCapacityCache,
  invalidateRuntimeCache,
} from '@/lib/notification-capacity/cache';
import { providerCapacityInputSchema, runtimeSettingsInputSchema } from '@/lib/notification-capacity/schema';
import { HARD_LIMITS } from '@/lib/notification-capacity/hard-limits';

const bulkPausedSchema = z.object({ bulkPaused: z.boolean() }).strict();

// GET: snapshot for Admin/Auditor — DB state + watermarks + limits (no secrets)
export async function GET() {
  const permissions = await getUserPermissions();
  if (!permissions.authenticated) return jsonError('Authentication required', 401);
  if (!permissions.capabilities.includes('admin.manage') && !permissions.capabilities.includes('audit.read' as never)) {
    // Fall back to role check so AUDITOR can read
    if (permissions.role !== 'AUDITOR' && permissions.role !== 'ADMIN') {
      return jsonError('Admin access required', 403);
    }
  }

  const [control, runtime, providerCapacities] = await Promise.all([
    prisma.systemConfig.findUnique({ where: { key: 'notification_capacity_control' } }),
    prisma.notificationRuntimeSettings.findUnique({ where: { id: 'default' } }),
    prisma.notificationProviderCapacity.findMany({ orderBy: [{ provider: 'asc' }, { channel: 'asc' }] }),
  ]);

  const controlValue =
    control?.value && typeof control.value === 'object' && !Array.isArray(control.value)
      ? (control.value as Record<string, unknown>)
      : {};

  return jsonOk({
    bulkPaused: controlValue.bulkPaused === true,
    runtime: runtime
      ? {
          bulkQueueLowWatermark: runtime.bulkQueueLowWatermark,
          bulkQueueHighWatermark: runtime.bulkQueueHighWatermark,
          defaultBulkSharePercent: runtime.defaultBulkSharePercent,
          adaptiveBackpressure: runtime.adaptiveBackpressure,
          revision: runtime.revision,
          updatedAt: runtime.updatedAt.toISOString(),
        }
      : null,
    providerCapacities: providerCapacities.map(row => ({
      provider: row.provider,
      channel: row.channel,
      mode: row.mode,
      ratePerSecond: row.ratePerSecond,
      maxInFlight: row.maxInFlight,
      bulkSharePercent: row.bulkSharePercent,
      adaptiveBackpressure: row.adaptiveBackpressure,
      revision: row.revision,
      updatedAt: row.updatedAt.toISOString(),
    })),
    hardLimits: HARD_LIMITS,
  });
}

export async function PATCH(request: NextRequest) {
  const permissions = await getUserPermissions();
  if (!permissions.authenticated) return jsonError('Authentication required', 401);
  if (!permissions.capabilities.includes('admin.manage')) {
    return jsonError('Admin access required', 403);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonError('Invalid capacity update', 400);
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return jsonError('Invalid capacity update', 400);
  }

  const record = input as Record<string, unknown>;

  // 1) Bulk pause toggle (legacy shape, keep compatible)
  if ('bulkPaused' in record && Object.keys(record).length === 1) {
    const parsed = bulkPausedSchema.safeParse(input);
    if (!parsed.success) return jsonError('Invalid capacity update', 400);
    const { bulkPaused } = parsed.data;
    const before = await prisma.systemConfig.findUnique({ where: { key: 'notification_capacity_control' } });
    const beforeValue = before?.value as Record<string, unknown> | null;
    await prisma.systemConfig.upsert({
      where: { key: 'notification_capacity_control' },
      create: {
        key: 'notification_capacity_control',
        value: { bulkPaused },
        updatedBy: permissions.id,
      },
      update: { value: { bulkPaused } as Prisma.InputJsonValue, updatedBy: permissions.id },
    });
    await logAudit({
      action: 'notification_capacity.updated',
      entityType: 'SYSTEM_CONFIG',
      entityId: 'notification_capacity_control',
      actorId: permissions.id,
      oldValue: (beforeValue ?? null) as Prisma.InputJsonValue | null,
      newValue: { bulkPaused } as Prisma.InputJsonValue,
      details: { kind: 'bulkPaused', bulkPaused } as Prisma.InputJsonValue,
    });
    invalidateNotificationCapacityControl();
    return jsonOk({ bulkPaused });
  }

  // 2) Provider capacity (per provider+channel)
  if ('provider' in record && 'channel' in record) {
    const parsed = providerCapacityInputSchema.safeParse(input);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || 'Invalid provider capacity';
      return jsonError(message, 400);
    }
    const data = parsed.data;
    const provider = data.provider.toLowerCase();
    const channel = data.channel;

    // Large increase confirmation is UI-enforced; server still enforces hard ceiling via schema.
    const existing = await prisma.notificationProviderCapacity.findUnique({
      where: { provider_channel: { provider, channel } },
    });

    if (data.revision != null && existing && data.revision !== existing.revision) {
      return jsonError('Settings changed elsewhere. Reload before saving.', 409);
    }
    if (data.revision != null && !existing) {
      return jsonError('Settings changed elsewhere. Reload before saving.', 409);
    }
    if (existing && data.revision == null) {
      return jsonError('Settings revision is required. Reload and try again.', 409);
    }

    const oldValue = existing
      ? ({
          provider: existing.provider,
          channel: existing.channel,
          mode: existing.mode,
          ratePerSecond: existing.ratePerSecond,
          maxInFlight: existing.maxInFlight,
          bulkSharePercent: existing.bulkSharePercent,
          adaptiveBackpressure: existing.adaptiveBackpressure,
          revision: existing.revision,
        } as Prisma.InputJsonValue)
      : null;

    const nextRevision = existing ? existing.revision + 1 : 1;
    const writeData = {
      mode: data.mode,
      ratePerSecond: data.mode === 'CUSTOM' ? (data.ratePerSecond as number) : null,
      maxInFlight: data.mode === 'CUSTOM' ? (data.maxInFlight as number) : null,
      bulkSharePercent: data.bulkSharePercent,
      adaptiveBackpressure: data.adaptiveBackpressure,
      updatedBy: permissions.id,
      revision: nextRevision,
    };

    let updated: { revision: number; updatedAt: Date };
    if (existing) {
      const result = await prisma.notificationProviderCapacity.updateMany({
        where: { provider, channel, revision: existing.revision },
        data: writeData,
      });
      if (result.count !== 1) return jsonError('Settings changed elsewhere. Reload before saving.', 409);
      updated = await prisma.notificationProviderCapacity.findUniqueOrThrow({
        where: { provider_channel: { provider, channel } },
        select: { revision: true, updatedAt: true },
      });
    } else {
      updated = await prisma.notificationProviderCapacity.create({
        data: { provider, channel, ...writeData },
        select: { revision: true, updatedAt: true },
      });
    }

    await logAudit({
      action: 'notification_provider_capacity.updated',
      entityType: 'SYSTEM_CONFIG',
      entityId: `${provider}:${channel}`,
      actorId: permissions.id,
      oldValue,
      newValue: {
        provider,
        channel,
        mode: data.mode,
        ratePerSecond: writeData.ratePerSecond,
        maxInFlight: writeData.maxInFlight,
        bulkSharePercent: data.bulkSharePercent,
        adaptiveBackpressure: data.adaptiveBackpressure,
        revision: nextRevision,
      } as Prisma.InputJsonValue,
      details: { kind: 'providerCapacity', provider, channel } as Prisma.InputJsonValue,
    });

    invalidateCapacityCache(`${channel}:${provider}`);
    return jsonOk({
      provider,
      channel,
      mode: data.mode,
      ratePerSecond: writeData.ratePerSecond,
      maxInFlight: writeData.maxInFlight,
      bulkSharePercent: data.bulkSharePercent,
      adaptiveBackpressure: data.adaptiveBackpressure,
      revision: updated.revision,
      updatedAt: updated.updatedAt.toISOString(),
    });
  }

  // 3) Runtime / queue watermarks
  if ('bulkQueueLowWatermark' in record || 'bulkQueueHighWatermark' in record || 'defaultBulkSharePercent' in record) {
    const parsed = runtimeSettingsInputSchema.safeParse(input);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || 'Invalid runtime settings';
      return jsonError(message, 400);
    }
    const data = parsed.data;
    const existing = await prisma.notificationRuntimeSettings.findUnique({ where: { id: 'default' } });
    if (data.revision != null && existing && data.revision !== existing.revision) {
      return jsonError('Settings changed elsewhere. Reload before saving.', 409);
    }
    if (existing && data.revision == null) {
      return jsonError('Settings revision is required. Reload and try again.', 409);
    }

    const oldValue = existing
      ? ({
          bulkQueueLowWatermark: existing.bulkQueueLowWatermark,
          bulkQueueHighWatermark: existing.bulkQueueHighWatermark,
          defaultBulkSharePercent: existing.defaultBulkSharePercent,
          adaptiveBackpressure: existing.adaptiveBackpressure,
          revision: existing.revision,
        } as Prisma.InputJsonValue)
      : null;

    const nextRevision = existing ? existing.revision + 1 : 1;
    const updated = await prisma.notificationRuntimeSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        bulkQueueLowWatermark: data.bulkQueueLowWatermark,
        bulkQueueHighWatermark: data.bulkQueueHighWatermark,
        defaultBulkSharePercent: data.defaultBulkSharePercent,
        adaptiveBackpressure: data.adaptiveBackpressure,
        revision: nextRevision,
        updatedBy: permissions.id,
      },
      update: {
        bulkQueueLowWatermark: data.bulkQueueLowWatermark,
        bulkQueueHighWatermark: data.bulkQueueHighWatermark,
        defaultBulkSharePercent: data.defaultBulkSharePercent,
        adaptiveBackpressure: data.adaptiveBackpressure,
        revision: nextRevision,
        updatedBy: permissions.id,
      },
      select: { revision: true, updatedAt: true },
    });

    await logAudit({
      action: 'notification_runtime_settings.updated',
      entityType: 'SYSTEM_CONFIG',
      entityId: 'notification_runtime_settings',
      actorId: permissions.id,
      oldValue,
      newValue: {
        bulkQueueLowWatermark: data.bulkQueueLowWatermark,
        bulkQueueHighWatermark: data.bulkQueueHighWatermark,
        defaultBulkSharePercent: data.defaultBulkSharePercent,
        adaptiveBackpressure: data.adaptiveBackpressure,
        revision: nextRevision,
      } as Prisma.InputJsonValue,
      details: { kind: 'runtimeSettings' } as Prisma.InputJsonValue,
    });

    invalidateRuntimeCache();
    // Default bulk share affects every computed capacity; invalidate process cache.
    invalidateCapacityCache();
    return jsonOk({
      bulkQueueLowWatermark: data.bulkQueueLowWatermark,
      bulkQueueHighWatermark: data.bulkQueueHighWatermark,
      defaultBulkSharePercent: data.defaultBulkSharePercent,
      adaptiveBackpressure: data.adaptiveBackpressure,
      revision: updated.revision,
      updatedAt: updated.updatedAt.toISOString(),
    });
  }

  return jsonError('Invalid capacity update', 400);
}
