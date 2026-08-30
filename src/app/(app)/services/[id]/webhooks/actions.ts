'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { assertCanModifyService } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { assertWebhookIntegrationNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import { assertSafeOutboundUrl } from '@/lib/network-security';
import { encrypt } from '@/lib/encryption';

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
  await assertSafeOutboundUrl(url);

  let normalizedName = name;
  try {
    normalizedName = await assertWebhookIntegrationNameAvailable(name);
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect(`/services/${serviceId}/webhooks/new?error=duplicate-webhook`);
    }
    throw error;
  }

  await prisma.webhookIntegration.create({
    data: {
      serviceId,
      name: normalizedName,
      type,
      url,
      secret: secret ? await encrypt(secret) : null,
      channel: channel || null,
      enabled: true,
    },
  });

  await logAudit({
    action: 'webhook.integration.created',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: { name: normalizedName, type },
  });

  revalidatePath(`/services/${serviceId}/settings`);
  redirect(`/services/${serviceId}/settings?saved=1`);
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
    select: { serviceId: true, secret: true },
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
  await assertSafeOutboundUrl(url);

  let normalizedName = name;
  try {
    normalizedName = await assertWebhookIntegrationNameAvailable(name, {
      excludeId: integrationId,
    });
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect(`/services/${ownedServiceId}/webhooks/${integrationId}/edit?error=duplicate-webhook`);
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
    details: { integrationId, name: normalizedName, type },
  });

  revalidatePath(`/services/${ownedServiceId}/settings`);
  revalidatePath(`/services/${ownedServiceId}/webhooks`);
  redirect(`/services/${ownedServiceId}/settings?saved=1`);
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

  revalidatePath(`/services/${existing.serviceId}/settings`);
}
