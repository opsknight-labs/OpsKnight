'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  parseSettingsRevision,
  settingsChangedState,
  type SettingsActionState,
} from '@/lib/settings-result';
import { chatOpsConfigSchema, saveChatOpsConfiguration } from '@/lib/chatops/config-command';

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
      success: false, code: 'FORBIDDEN',
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
      updatedAt: expectedUpdatedAt,
    };
  }

  try {
    const channelPrefix = String(formData.get('channelPrefix') ?? 'inc')
      .trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 20);
    const defaultProvidersOption = String(formData.get('defaultProviders') ?? 'BOTH');
    const defaultProviders = defaultProvidersOption === 'SLACK' ? ['SLACK']
      : defaultProvidersOption === 'MICROSOFT_TEAMS' ? ['MICROSOFT_TEAMS']
        : ['SLACK', 'MICROSOFT_TEAMS'];
    const parsed = chatOpsConfigSchema.safeParse({
      enabled: ['on', 'true'].includes(String(formData.get('enabled') ?? '')),
      channelPrefix,
      autoCreateOnUrgency: formData.getAll('autoCreateOnUrgency'),
      autoCreateOnPriority: formData.getAll('autoCreateOnPriority'),
      archiveOnResolve: ['on', 'true'].includes(String(formData.get('archiveOnResolve') ?? '')),
      defaultVideoBridge: String(formData.get('defaultVideoBridge') ?? 'NONE'),
      customBridgeUrlTemplate: String(formData.get('customBridgeUrlTemplate') ?? '').trim(),
      defaultProviders,
    });
    if (!parsed.success) return {
      success: false, code: 'VALIDATION_ERROR',
      error: parsed.error.issues[0]?.message || 'Invalid ChatOps configuration.',
      updatedAt: expectedUpdatedAt,
    };
    const expected = parseSettingsRevision(expectedUpdatedAt);
    if (expectedUpdatedAt && !expected) return settingsChangedState(expectedUpdatedAt);
    const saved = await prisma.$transaction(tx => saveChatOpsConfiguration(
      parsed.data, { updatedAt: expected }, { id: actor.id, source: 'UI' }, tx
    ));
    revalidatePath('/settings');
    revalidatePath('/settings/integrations/chatops');
    return { success: true, error: null, updatedAt: saved.updatedAt?.toISOString() ?? null };
  } catch (error) {
    if ((error instanceof AppError && error.code === 'PRECONDITION_FAILED') ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      return settingsChangedState(expectedUpdatedAt);
    }
    logger.error('settings.chatops.save_failed', { error });
    return { success: false, code: 'INTERNAL_ERROR', error: 'Failed to save ChatOps configuration.',
      updatedAt: expectedUpdatedAt };
  }
}
