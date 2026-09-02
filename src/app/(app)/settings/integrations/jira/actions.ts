'use server';

import prisma from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { logAudit } from '@/lib/audit';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { normalizeJiraBaseUrl } from '@/lib/jira-validation';
import { revalidatePath } from 'next/cache';

type JiraConfigState = {
  success?: boolean;
  error?: string | null;
};

export async function saveJiraConfig(
  _prevState: JiraConfigState | undefined,
  formData: FormData
): Promise<JiraConfigState> {
  try {
    await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  try {
    const baseUrl = normalizeJiraBaseUrl((formData.get('baseUrl') as string | null) ?? '');
    const userEmail = ((formData.get('userEmail') as string | null) ?? '').trim().toLowerCase();
    const apiToken = ((formData.get('apiToken') as string | null) ?? '').trim();
    const webhookSecret = ((formData.get('webhookSecret') as string | null) ?? '').trim();
    const enabledValue = formData.get('enabled');
    const enabled = enabledValue === 'on' || enabledValue === 'true';

    if (!userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return { error: 'A valid Jira user email is required.' };
    }

    const existing = await prisma.jiraConfig.findUnique({ where: { id: 'default' } });
    if (!existing && !apiToken) {
      return { error: 'Jira API token is required for new configuration.' };
    }

    const apiTokenEncrypted =
      apiToken && apiToken !== '********' ? await encrypt(apiToken) : existing?.apiTokenEncrypted;
    const webhookSecretEncrypted =
      webhookSecret && webhookSecret !== '********'
        ? await encrypt(webhookSecret)
        : existing?.webhookSecretEncrypted;

    if (!apiTokenEncrypted) {
      return { error: 'Jira API token is required.' };
    }

    const user = await getCurrentUser();

    await prisma.jiraConfig.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        baseUrl,
        userEmail,
        apiTokenEncrypted,
        enabled,
        defaultProjectKey: null,
        webhookSecretEncrypted,
        updatedBy: user.id,
      },
      update: {
        baseUrl,
        userEmail,
        apiTokenEncrypted,
        enabled,
        defaultProjectKey: null,
        webhookSecretEncrypted,
        updatedBy: user.id,
      },
    });

    await logAudit({
      action: 'jira.config.updated',
      entityType: 'USER',
      entityId: user.id,
      actorId: user.id,
      details: {
        enabled,
        baseUrl,
        userEmail,
        hasWebhookSecret: Boolean(webhookSecretEncrypted),
      },
    });

    revalidatePath('/settings');
    revalidatePath('/settings/integrations/jira');

    return { success: true, error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to save Jira configuration.' };
  }
}
