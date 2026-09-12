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

// GET: snapshot for Admin/Auditor — DB state + effective resolved values + watermarks + limits (no secrets)
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

  // Effective resolved view (DB > ENV > DEFAULT) for lossless ENV→UI takeover.
  // Lazy import to avoid circular deps; resolver uses prisma + env.
  const { getEffectiveCapacity, getEffectiveWatermarks } = await import('@/lib/notification-capacity/resolver');
  const channels = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'SLACK', 'WEBHOOK'] as const;
  const seen = new Set(providerCapacities.map(r => `${r.channel}:${r.provider}`));
  const inventory: Array<{ channel: (typeof channels)[number]; provider: string }> = [
    ...providerCapacities.map(r => ({ channel: r.channel as (typeof channels)[number], provider: r.provider })),
  ];
  // Include actually configured providers (e.g. ses without DB row + ENV override)
  // before synthetic defaults so a channel already covered by a real provider
  // (EMAIL:ses) does not get a redundant EMAIL:default shadowing it.
  try {
    const configuredProviders = await prisma.notificationProvider.findMany({ select: { provider: true, enabled: true } });
    const providerToChannel: Record<string, (typeof channels)[number]> = {
      resend: 'EMAIL',
      sendgrid: 'EMAIL',
      ses: 'EMAIL',
      smtp: 'EMAIL',
      twilio: 'SMS',
      'aws-sns': 'SMS',
      'web-push': 'PUSH',
    };
    for (const rec of configuredProviders) {
      if (!rec.enabled) continue;
      const channel = providerToChannel[rec.provider];
      if (!channel) continue;
      const key = `${channel}:${rec.provider}`;
      if (!seen.has(key)) {
        seen.add(key);
        inventory.push({ channel, provider: rec.provider });
      }
      // Twilio also backs WHATSAPP — expose separate WHATSAPP:twilio entry
      if (rec.provider === 'twilio') {
        const wKey = `WHATSAPP:twilio`;
        if (!seen.has(wKey)) {
          seen.add(wKey);
          inventory.push({ channel: 'WHATSAPP', provider: 'twilio' });
        }
      }
    }
  } catch {
    // Inventory still truthful without configured-provider expansion.
  }
  for (const channel of channels) {
    const hasChannel = inventory.some(r => r.channel === channel);
    if (!hasChannel) {
      const key = `${channel}:default`;
      if (!seen.has(key)) {
        seen.add(key);
        inventory.push({ channel, provider: 'default' });
      }
    }
  }
  for (const ch of ['SLACK', 'WEBHOOK'] as const) {
    const key = `${ch}:default`;
    if (!seen.has(key)) {
      seen.add(key);
      inventory.push({ channel: ch, provider: 'default' });
    }
  }

  const [effectiveCapacities, effectiveWatermarks] = await Promise.all([
    Promise.all(inventory.map(({ channel, provider }) => getEffectiveCapacity({ channel: channel as never, provider }))),
    getEffectiveWatermarks(),
  ]);

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
    effectiveCapacities: effectiveCapacities.map(c => ({
      provider: c.provider,
      channel: c.channel,
      mode: c.mode,
      source: c.source,
      configuredRatePerSecond: c.configuredRatePerSecond,
      effectiveRatePerSecond: c.effectiveRatePerSecond,
      bulkRatePerSecond: c.bulkRatePerSecond,
      maxInFlight: c.maxInFlight,
      bulkMaxInFlight: c.bulkMaxInFlight,
      bulkShare: c.bulkShare,
      adaptiveBackpressure: c.adaptiveBackpressure,
      revision: c.revision,
    })),
    effectiveWatermarks,
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
    await prisma.$transaction(async tx => {
      await tx.systemConfig.upsert({
        where: { key: 'notification_capacity_control' },
        create: {
          key: 'notification_capacity_control',
          value: { bulkPaused },
          updatedBy: permissions.id,
        },
        update: { value: { bulkPaused } as Prisma.InputJsonValue, updatedBy: permissions.id },
      });
      await logAudit(
        {
          action: 'notification_capacity.updated',
          entityType: 'SYSTEM_CONFIG',
          entityId: 'notification_capacity_control',
          actorId: permissions.id,
          oldValue: (beforeValue ?? null) as Prisma.InputJsonValue | null,
          newValue: { bulkPaused } as Prisma.InputJsonValue,
          details: { kind: 'bulkPaused', bulkPaused } as Prisma.InputJsonValue,
        },
        tx as never
      );
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

    const existing = await prisma.notificationProviderCapacity.findUnique({
      where: { provider_channel: { provider, channel } },
    });

    // Server-enforce acknowledgement for extreme jumps so curl/direct callers cannot bypass the UI modal.
    // Persisted row: 3× or ≥2× at ≥2k. No row yet (ENV takeover): absolute ≥2000 still gates.
    if (data.mode === 'CUSTOM' && data.ratePerSecond != null) {
      const nextRate = data.ratePerSecond as number;
      if (existing?.ratePerSecond != null) {
        const oldRate = existing.ratePerSecond;
        const largeJump =
          (nextRate > 500 && nextRate >= oldRate * 3) || (nextRate >= 2000 && nextRate > oldRate * 2);
        if (largeJump && data.acknowledgeRisk !== true) {
          return jsonError('Large capacity increase requires acknowledgeRisk: true — confirm the provider quota permits this rate.', 400);
        }
      } else if (nextRate >= 2000 && data.acknowledgeRisk !== true) {
        return jsonError('Large capacity increase requires acknowledgeRisk: true — confirm the provider quota permits this rate.', 400);
      }
    }

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

    const auditNewValue = {
      provider,
      channel,
      mode: data.mode,
      ratePerSecond: writeData.ratePerSecond,
      maxInFlight: writeData.maxInFlight,
      bulkSharePercent: data.bulkSharePercent,
      adaptiveBackpressure: data.adaptiveBackpressure,
      revision: nextRevision,
    } as Prisma.InputJsonValue;
    const auditDetails = { kind: 'providerCapacity', provider, channel } as Prisma.InputJsonValue;
    let updated: { revision: number; updatedAt: Date };
    try {
      updated = await prisma.$transaction(async tx => {
        let inner: { revision: number; updatedAt: Date };
        if (existing) {
          const result = await tx.notificationProviderCapacity.updateMany({
            where: { provider, channel, revision: existing.revision },
            data: writeData,
          });
          if (result.count !== 1) throw Object.assign(new Error('CAS_CONFLICT'), { code: 'CAS_CONFLICT' });
          inner = await tx.notificationProviderCapacity.findUniqueOrThrow({
            where: { provider_channel: { provider, channel } },
            select: { revision: true, updatedAt: true },
          });
        } else {
          try {
            inner = await tx.notificationProviderCapacity.create({
              data: { provider, channel, ...writeData },
              select: { revision: true, updatedAt: true },
            });
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              throw Object.assign(new Error('CAS_CONFLICT'), { code: 'CAS_CONFLICT' });
            }
            throw e;
          }
        }
        await logAudit(
          {
            action: 'notification_provider_capacity.updated',
            entityType: 'SYSTEM_CONFIG',
            entityId: `${provider}:${channel}`,
            actorId: permissions.id,
            oldValue,
            newValue: auditNewValue,
            details: auditDetails,
          },
          tx as never
        );
        return inner;
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'CAS_CONFLICT') {
        return jsonError('Settings changed elsewhere. Reload before saving.', 409);
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return jsonError('Settings changed elsewhere. Reload before saving.', 409);
      }
      throw e;
    }

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
    let updated2!: { revision: number; updatedAt: Date };
    const runtimeAuditNewValue = {
      bulkQueueLowWatermark: data.bulkQueueLowWatermark,
      bulkQueueHighWatermark: data.bulkQueueHighWatermark,
      defaultBulkSharePercent: data.defaultBulkSharePercent,
      adaptiveBackpressure: data.adaptiveBackpressure,
      revision: nextRevision,
    } as Prisma.InputJsonValue;
    try {
      await prisma.$transaction(async tx => {
        let createdOrUpdated: { revision: number; updatedAt: Date };
        if (!existing) {
          try {
            createdOrUpdated = await tx.notificationRuntimeSettings.create({
              data: {
                id: 'default',
                bulkQueueLowWatermark: data.bulkQueueLowWatermark,
                bulkQueueHighWatermark: data.bulkQueueHighWatermark,
                defaultBulkSharePercent: data.defaultBulkSharePercent,
                adaptiveBackpressure: data.adaptiveBackpressure,
                revision: nextRevision,
                updatedBy: permissions.id,
              },
              select: { revision: true, updatedAt: true },
            });
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              throw Object.assign(new Error('CAS_CONFLICT'), { code: 'CAS_CONFLICT' });
            }
            throw e;
          }
        } else {
          // CAS: conditional update keyed on expected revision so two concurrent
          // admins reading rev 5 cannot both silently advance to rev 6.
          const result = await tx.notificationRuntimeSettings.updateMany({
            where: { id: 'default', revision: existing.revision },
            data: {
              bulkQueueLowWatermark: data.bulkQueueLowWatermark,
              bulkQueueHighWatermark: data.bulkQueueHighWatermark,
              defaultBulkSharePercent: data.defaultBulkSharePercent,
              adaptiveBackpressure: data.adaptiveBackpressure,
              revision: nextRevision,
              updatedBy: permissions.id,
            },
          });
          if (result.count !== 1) throw Object.assign(new Error('CAS_CONFLICT'), { code: 'CAS_CONFLICT' });
          createdOrUpdated = await tx.notificationRuntimeSettings.findUniqueOrThrow({
            where: { id: 'default' },
            select: { revision: true, updatedAt: true },
          });
        }
        await logAudit(
          {
            action: 'notification_runtime_settings.updated',
            entityType: 'SYSTEM_CONFIG',
            entityId: 'notification_runtime_settings',
            actorId: permissions.id,
            oldValue,
            newValue: runtimeAuditNewValue,
            details: { kind: 'runtimeSettings' } as Prisma.InputJsonValue,
          },
          tx as never
        );
        updated2 = createdOrUpdated;
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'CAS_CONFLICT') {
        return jsonError('Settings changed elsewhere. Reload before saving.', 409);
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return jsonError('Settings changed elsewhere. Reload before saving.', 409);
      }
      throw e;
    }

    invalidateRuntimeCache();
    // Default bulk share affects every computed capacity; invalidate process cache.
    invalidateCapacityCache();
    return jsonOk({
      bulkQueueLowWatermark: data.bulkQueueLowWatermark,
      bulkQueueHighWatermark: data.bulkQueueHighWatermark,
      defaultBulkSharePercent: data.defaultBulkSharePercent,
      adaptiveBackpressure: data.adaptiveBackpressure,
      revision: updated2.revision,
      updatedAt: updated2.updatedAt.toISOString(),
    });
  }

  return jsonError('Invalid capacity update', 400);
}
