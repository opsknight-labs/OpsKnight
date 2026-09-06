'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { encrypt } from '@/lib/encryption';

export async function saveSlackOAuthConfig(
  formData: FormData
): Promise<{ error?: string } | undefined> {
  try {
    await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  const clientId = formData.get('clientId') as string;
  const clientSecret = formData.get('clientSecret') as string;
  const signingSecret = formData.get('signingSecret') as string;
  const redirectUri = formData.get('redirectUri') as string;
  const enabledValue = formData.get('enabled');
  const enabled = enabledValue === 'on' || enabledValue === 'true';

  // Get existing config to preserve values that were not resubmitted
  const existing = await prisma.slackOAuthConfig.findFirst({
    orderBy: { updatedAt: 'desc' },
  });

  // Check if this is a signing secret update (e.g. from SlackSigningSecretCard)
  const isSigningSecretOnly = !clientId && Boolean(signingSecret);

  // Allows updating just the signing secret without re-entering app credentials
  let effectiveClientId = clientId ? clientId.trim() : existing?.clientId;
  if (!effectiveClientId) {
    if (isSigningSecretOnly) {
      effectiveClientId = process.env.SLACK_CLIENT_ID || 'workspace-credentials';
    } else {
      return { error: 'Client ID is required' };
    }
  }

  // Validate clientId format: reject Slack Workspace IDs (starts with T) and App IDs (starts with A)
  if (clientId) {
    const trimmed = clientId.trim();
    if (trimmed.startsWith('T') && /^T[A-Z0-9]+$/i.test(trimmed)) {
      return {
        error:
          "Invalid Client ID: '" +
          trimmed +
          "' is a Slack Workspace/Team ID (starts with 'T'). Please enter your OAuth Client ID from https://api.slack.com/apps (under Basic Information > App Credentials, formatted like '123456789.987654321').",
      };
    }
    if (trimmed.startsWith('A') && /^A[A-Z0-9]+$/i.test(trimmed)) {
      return {
        error:
          "Invalid Client ID: '" +
          trimmed +
          "' is a Slack App ID (starts with 'A'). Please enter your OAuth Client ID from https://api.slack.com/apps (under Basic Information > App Credentials, formatted like '123456789.987654321').",
      };
    }
  }

  // If updating and secret is not provided (or is placeholder), keep existing
  let encryptedSecret = existing?.clientSecret;
  if (clientSecret && clientSecret !== '********' && clientSecret.trim() !== '') {
    encryptedSecret = await encrypt(clientSecret);
  } else if (!existing) {
    if (process.env.SLACK_CLIENT_SECRET) {
      encryptedSecret = await encrypt(process.env.SLACK_CLIENT_SECRET);
    } else if (isSigningSecretOnly) {
      encryptedSecret = await encrypt('managed-credentials');
    } else {
      return { error: 'Client Secret is required for new configuration' };
    }
  }

  // Slack never returns the signing secret from OAuth — it is an app-level
  // credential entered once here, and preserved when the field is left masked.
  let encryptedSigningSecret = existing?.signingSecret ?? null;
  if (signingSecret && signingSecret !== '********' && signingSecret.trim() !== '') {
    encryptedSigningSecret = await encrypt(signingSecret.trim());
  }

  const user = await getCurrentUser();
  const actorId = user.id;

  // Upsert config (only one config record)
  await prisma.slackOAuthConfig.upsert({
    where: { id: existing?.id || 'default' },
    create: {
      id: 'default',
      clientId: effectiveClientId,
      clientSecret: encryptedSecret!,
      signingSecret: encryptedSigningSecret,
      redirectUri: redirectUri || null,
      enabled: enabledValue ? enabled : (existing?.enabled ?? true),
      updatedBy: actorId,
    },
    update: {
      clientId: effectiveClientId,
      ...(encryptedSecret ? { clientSecret: encryptedSecret } : {}),
      signingSecret: encryptedSigningSecret,
      redirectUri: redirectUri || existing?.redirectUri || null,
      ...(enabledValue ? { enabled } : {}),
      updatedBy: actorId,
    },
  });

  const { resetSigningSecretCache } = await import('@/lib/slack-signature');
  resetSigningSecretCache();

  await logAudit({
    action: 'slack.oauth.config.updated',
    entityType: 'USER',
    entityId: user.id,
    actorId,
    details: {
      enabled,
      clientId: effectiveClientId.substring(0, 10) + '...',
      configType: 'slack-oauth',
      signingSecretConfigured: Boolean(encryptedSigningSecret),
    },
  });

  revalidatePath('/settings');
  revalidatePath('/settings/integrations/slack');
  revalidatePath('/services');

  return undefined; // Success
}
