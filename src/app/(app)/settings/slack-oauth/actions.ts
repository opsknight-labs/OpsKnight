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

  // Allows updating just the signing secret without re-entering app credentials
  const effectiveClientId = clientId || existing?.clientId;
  if (!effectiveClientId) {
    return { error: 'Client ID is required' };
  }

  // If updating and secret is not provided (or is placeholder), keep existing
  let encryptedSecret = existing?.clientSecret;
  if (clientSecret && clientSecret !== '********' && clientSecret.trim() !== '') {
    encryptedSecret = await encrypt(clientSecret);
  } else if (!existing) {
    return { error: 'Client Secret is required for new configuration' };
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
      enabled,
      updatedBy: actorId,
    },
    update: {
      clientId: effectiveClientId,
      ...(encryptedSecret ? { clientSecret: encryptedSecret } : {}),
      signingSecret: encryptedSigningSecret,
      redirectUri: redirectUri || existing?.redirectUri || null,
      enabled,
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
