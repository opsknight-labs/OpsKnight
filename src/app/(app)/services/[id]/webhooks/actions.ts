'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { assertCanModifyService } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { assertWebhookIntegrationNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import { assertSafeOutboundUrl } from '@/lib/network-security';
import { encrypt } from '@/lib/encryption';
import { allowsInsecureWebhookUrls } from '@/lib/webhook-url-policy';

// Returns false for malformed, internal-network or (unless an admin allows it)
// plaintext URLs so the form can show a readable error instead of a masked
// server-action exception.
async function isAcceptableWebhookUrl(url: string): Promise<boolean> {
  const requireHttps = !(await allowsInsecureWebhookUrls());
  try {
    await assertSafeOutboundUrl(url, { requireHttps });
    return true;
  } catch {
    return false;
  }
}

export async function createWebhookIntegration(serviceId: string, formData: FormData) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertCanModifyService(serviceId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const name = formData.get('name') as string;
  const type = formData.get('type') as string;
  const url = formData.get('url') as string;
  const secret = formData.get('secret') as string;
  const channel = formData.get('channel') as string;

  if (!name || !type || !url) {
    throw new Error('Name, type, and URL are required');
  }
  if (!(await isAcceptableWebhookUrl(url))) {
    redirect(`/services/${serviceId}/webhooks/new?error=invalid-url`);
  }

  let normalizedName = name;
  try {
    normalizedName = await assertWebhookIntegrationNameAvailable(name, { serviceId });
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect(`/services/${serviceId}/webhooks/new?error=duplicate-webhook`);
    }
    throw error;
  }

  const encryptedSecret = secret ? await encrypt(secret) : null;
  // Delivery is gated on the service's WEBHOOK channel; enable it with the
  // first webhook (as the Slack/Teams destination routes do for their channels).
  await prisma.$transaction(async tx => {
    await tx.webhookIntegration.create({
      data: {
        serviceId,
        name: normalizedName,
        type,
        url,
        secret: encryptedSecret,
        channel: channel || null,
        enabled: true,
      },
    });
    const service = await tx.service.findUnique({
      where: { id: serviceId },
      select: { serviceNotificationChannels: true },
    });
    if (service && !service.serviceNotificationChannels.includes('WEBHOOK')) {
      await tx.service.update({
        where: { id: serviceId },
        data: { serviceNotificationChannels: { push: 'WEBHOOK' } },
      });
    }
  });

  await logAudit({
    action: 'webhook.integration.created',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: { name: normalizedName, type, urlHost: new URL(url).host, hasSecret: !!secret },
  });

  revalidatePath(`/services/${serviceId}`);
  revalidatePath(`/services/${serviceId}/notifications`);
  redirect(`/services/${serviceId}?tab=notifications&saved=1`);
}

export async function updateWebhookIntegration(
  integrationId: string,
  _serviceId: string,
  formData: FormData
) {
  // Always authorize against the integration's persisted service. The route
  // parameter is client-controlled and must not determine access.
  const existing = await prisma.webhookIntegration.findUnique({
    where: { id: integrationId },
    select: { serviceId: true, secret: true, url: true, type: true, enabled: true, name: true },
  });
  if (!existing) throw new Error('Webhook integration not found');

  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertCanModifyService(existing.serviceId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }
  const ownedServiceId = existing.serviceId;

  const name = formData.get('name') as string;
  const type = formData.get('type') as string;
  const url = formData.get('url') as string;
  const secret = formData.get('secret') as string;
  const channel = formData.get('channel') as string;
  const enabled = formData.get('enabled') === 'true';

  if (!name || !type || !url) {
    throw new Error('Name, type, and URL are required');
  }
  if (!(await isAcceptableWebhookUrl(url))) {
    redirect(`/services/${ownedServiceId}/webhooks/${integrationId}/edit?error=invalid-url`);
  }

  let normalizedName = name;
  try {
    normalizedName = await assertWebhookIntegrationNameAvailable(name, {
      excludeId: integrationId,
      serviceId: ownedServiceId,
    });
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect(
        `/services/${ownedServiceId}/webhooks/${integrationId}/edit?error=duplicate-webhook`
      );
    }
    throw error;
  }

  await prisma.webhookIntegration.update({
    where: { id: integrationId },
    data: {
      name: normalizedName,
      type,
      url,
      secret: secret ? await encrypt(secret) : existing.secret || null,
      channel: channel || null,
      enabled,
    },
  });

  await logAudit({
    action: 'webhook.integration.updated',
    entityType: 'SERVICE',
    entityId: ownedServiceId,
    actorId: currentUser.id,
    // Record retargeting, secret rotation and toggles without logging the URL
    // itself (its path often carries a token).
    details: {
      integrationId,
      name: normalizedName,
      type,
      previousName: existing.name,
      previousType: existing.type,
      urlChanged: existing.url !== url,
      previousUrlHost: URL.canParse(existing.url) ? new URL(existing.url).host : null,
      urlHost: new URL(url).host,
      secretRotated: !!secret,
      enabled,
      previousEnabled: existing.enabled,
    },
  });

  revalidatePath(`/services/${ownedServiceId}`);
  revalidatePath(`/services/${ownedServiceId}/notifications`);
  redirect(`/services/${ownedServiceId}?tab=notifications&saved=1`);
}

export async function deleteWebhookIntegration(integrationId: string, _serviceId: string) {
  const existing = await prisma.webhookIntegration.findUnique({
    where: { id: integrationId },
    select: { serviceId: true },
  });
  if (!existing) throw new Error('Webhook integration not found');

  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertCanModifyService(existing.serviceId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  await prisma.webhookIntegration.delete({
    where: { id: integrationId },
  });

  await logAudit({
    action: 'webhook.integration.deleted',
    entityType: 'SERVICE',
    entityId: existing.serviceId,
    actorId: currentUser.id,
    details: { integrationId },
  });

  revalidatePath(`/services/${existing.serviceId}`);
  revalidatePath(`/services/${existing.serviceId}/notifications`);
}
