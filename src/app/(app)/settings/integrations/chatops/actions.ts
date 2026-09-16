'use server';

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { assertAdmin } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import {
  SettingsChangedMutationError,
  isSettingsChangedError,
  parseSettingsRevision,
  settingsChangedState,
  type SettingsActionState,
} from '@/lib/settings-result';
import {
  getGlobalWarRoomPolicy,
  setGlobalDefaultWarRoomProviders,
} from '@/lib/incident-collaboration/policy';
import type { WarRoomProviderSet } from '@/lib/incident-collaboration/types';

const ALLOWED_BRIDGE_TEMPLATE_VARIABLES = new Set(['incidentId']);

const ChatOpsConfigSchema = z
  .object({
    enabled: z.boolean(),
    channelPrefix: z.string().trim().min(1).max(20),
    autoCreateOnUrgency: z.array(z.enum(['HIGH', 'MEDIUM', 'LOW'])).max(3),
    autoCreateOnPriority: z.array(z.enum(['P1', 'P2', 'P3', 'P4', 'P5'])).max(5),
    archiveOnResolve: z.boolean(),
    defaultVideoBridge: z.enum(['JITSI', 'ZOOM', 'GOOGLE_MEET', 'NONE']),
    customBridgeUrlTemplate: z.string().trim().max(2048),
  })
  .superRefine((value, ctx) => {
    if (!value.customBridgeUrlTemplate) return;

    const placeholders = Array.from(value.customBridgeUrlTemplate.matchAll(/\{([^{}]+)\}/g)).map(
      match => match[1]
    );
    const unsupportedPlaceholder = placeholders.find(
      placeholder => !ALLOWED_BRIDGE_TEMPLATE_VARIABLES.has(placeholder)
    );
    if (unsupportedPlaceholder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customBridgeUrlTemplate'],
        message: `Unsupported bridge URL template variable: {${unsupportedPlaceholder}}.`,
      });
      return;
    }

    const probe = value.customBridgeUrlTemplate.replaceAll('{incidentId}', 'incident-id');
    try {
      const url = new URL(probe);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customBridgeUrlTemplate'],
        message: 'Custom bridge URL must be a valid HTTP(S) URL template.',
      });
    }
  });

export async function saveChatOpsConfig(
  prevState: SettingsActionState | undefined,
  formData: FormData
): Promise<SettingsActionState> {
  const expectedUpdatedAt = prevState?.updatedAt ?? null;
  let actor;
  try {
    actor = await assertAdmin();
  } catch (error) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
      updatedAt: expectedUpdatedAt,
    };
  }

  try {
    const channelPrefix = ((formData.get('channelPrefix') as string | null) ?? 'inc')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20);

    const parsed = ChatOpsConfigSchema.safeParse({
      enabled: ['on', 'true'].includes(String(formData.get('enabled') ?? '')),
      channelPrefix,
      autoCreateOnUrgency: formData.getAll('autoCreateOnUrgency'),
      autoCreateOnPriority: formData.getAll('autoCreateOnPriority'),
      archiveOnResolve: ['on', 'true'].includes(String(formData.get('archiveOnResolve') ?? '')),
      defaultVideoBridge: (formData.get('defaultVideoBridge') as string | null) ?? 'NONE',
      customBridgeUrlTemplate: (
        (formData.get('customBridgeUrlTemplate') as string | null) ?? ''
      ).trim(),
    });

    if (!parsed.success) {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        error: parsed.error.issues[0]?.message || 'Invalid ChatOps configuration.',
        updatedAt: expectedUpdatedAt,
      };
    }

    const defaultProvidersOption = (formData.get('defaultProviders') as string | null) ?? 'BOTH';
    let defaultProviders: WarRoomProviderSet = ['SLACK', 'MICROSOFT_TEAMS'];
    if (defaultProvidersOption === 'SLACK') {
      defaultProviders = ['SLACK'];
    } else if (defaultProvidersOption === 'MICROSOFT_TEAMS') {
      defaultProviders = ['MICROSOFT_TEAMS'];
    } else {
      defaultProviders = ['SLACK', 'MICROSOFT_TEAMS'];
    }

    const next = parsed.data;
    const [existing, existingGlobalPolicy] = await Promise.all([
      prisma.chatOpsConfig.findUnique({ where: { id: 'default' } }),
      getGlobalWarRoomPolicy(),
    ]);
    const expectedRevision = parseSettingsRevision(expectedUpdatedAt);
    if (existing && !expectedRevision) return settingsChangedState(expectedUpdatedAt);
    if (!existing && expectedRevision) return settingsChangedState(expectedUpdatedAt);

    const updatedAt = await prisma.$transaction(async tx => {
      if (existing) {
        const updated = await tx.chatOpsConfig.updateMany({
          where: { id: existing.id, updatedAt: expectedRevision! },
          data: {
            ...next,
            customBridgeUrlTemplate: next.customBridgeUrlTemplate || null,
          },
        });
        if (updated.count !== 1) throw new SettingsChangedMutationError();
      } else {
        await tx.chatOpsConfig.create({
          data: {
            id: 'default',
            ...next,
            customBridgeUrlTemplate: next.customBridgeUrlTemplate || null,
          },
        });
      }

      await setGlobalDefaultWarRoomProviders(defaultProviders, actor.id, tx);

      await logAudit(
        {
          action: 'chatops.config.updated',
          entityType: 'SERVICE',
          entityId: 'chatops-config',
          actorId: actor.id,
          oldValue: existing
            ? {
                enabled: existing.enabled,
                channelPrefix: existing.channelPrefix,
                autoCreateOnUrgency: existing.autoCreateOnUrgency,
                autoCreateOnPriority: existing.autoCreateOnPriority,
                archiveOnResolve: existing.archiveOnResolve,
                defaultVideoBridge: existing.defaultVideoBridge,
                customBridgeUrlTemplate: existing.customBridgeUrlTemplate,
                defaultProviders: existingGlobalPolicy.defaultProviders,
              }
            : null,
          newValue: {
            enabled: next.enabled,
            channelPrefix: next.channelPrefix,
            autoCreateOnUrgency: next.autoCreateOnUrgency,
            autoCreateOnPriority: next.autoCreateOnPriority,
            archiveOnResolve: next.archiveOnResolve,
            defaultVideoBridge: next.defaultVideoBridge,
            customBridgeUrlTemplate: next.customBridgeUrlTemplate || null,
            defaultProviders,
          },
        },
        tx
      );

      const saved = await tx.chatOpsConfig.findUniqueOrThrow({
        where: { id: existing?.id ?? 'default' },
        select: { updatedAt: true },
      });
      return saved.updatedAt.toISOString();
    });

    revalidatePath('/settings');
    revalidatePath('/settings/integrations/chatops');

    return { success: true, error: null, updatedAt };
  } catch (error) {
    if (
      isSettingsChangedError(error) ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    ) {
      return settingsChangedState(expectedUpdatedAt);
    }
    logger.error('settings.chatops.save_failed', { error });
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Failed to save ChatOps configuration.',
      updatedAt: expectedUpdatedAt,
    };
  }
}
