'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { randomBytes } from 'crypto';
import { encrypt } from '@/lib/encryption';
import { logAudit } from '@/lib/audit';
import { assertAdmin, assertCanModifyService } from '@/lib/rbac';
import { assertServiceNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import { assertJiraIssueType, assertJiraProjectKey, parseLabels } from '@/lib/jira-validation';
import { parseServiceNotificationChannels } from '@/lib/service-notification-settings';

const JIRA_AUTO_CREATE_URGENCIES = new Set(['HIGH', 'MEDIUM', 'LOW']);
function serviceSettingsRedirect(serviceId: string) {
  return `/services/${serviceId}?tab=settings&saved=1`;
}

export async function createIntegration(formData: FormData) {
  const serviceId = formData.get('serviceId') as string;
  const name = formData.get('name') as string;
  const type = (formData.get('type') as string) || 'EVENTS_API_V2';
  if (!serviceId || !name) throw new Error('Missing required fields');

  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertCanModifyService(serviceId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }
  // Generate a random 32-char hex key
  const key = randomBytes(16).toString('hex');

  await prisma.integration.create({
    data: {
      name,
      serviceId,
      type,
      key,
    },
  });

  await logAudit({
    action: 'integration.created',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: { name, type },
  });

  revalidatePath(`/services/${serviceId}/integrations`);
}

export async function deleteIntegration(
  integrationId: string,
  serviceId: string,
  _formData?: FormData
) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertCanModifyService(serviceId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, serviceId },
    select: { id: true },
  });
  if (!integration) throw new Error('Integration not found for this service.');
  await prisma.integration.delete({ where: { id: integration.id } });

  await logAudit({
    action: 'integration.deleted',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: { integrationId },
  });

  revalidatePath(`/services/${serviceId}/integrations`);
  revalidatePath(`/services/${serviceId}`);
}

export async function updateService(serviceId: string, formData: FormData) {
  let currentUser: { id: string; role?: string } | null = null;
  try {
    currentUser = await assertCanModifyService(serviceId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }
  const rawName = formData.get('name');
  const name = typeof rawName === 'string' ? rawName : '';
  const description = formData.get('description') as string;
  const region = formData.get('region') as string;
  const slaTier = formData.get('slaTier') as string;
  const teamId = formData.get('teamId') as string;
  const escalationPolicyId = formData.get('escalationPolicyId') as string;

  if (teamId && currentUser.role !== 'ADMIN') {
    const destinationMembership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { teamId, userId: currentUser.id } },
      select: { id: true },
    });
    if (!destinationMembership) {
      throw new Error('Unauthorized. You cannot move a service into another team.');
    }
  }

  try {
    const normalizedName = await assertServiceNameAvailable(name, { excludeId: serviceId });

    await prisma.service.update({
      where: { id: serviceId },
      data: {
        name: normalizedName,
        description,
        region: region || null,
        slaTier: slaTier || null,
        teamId: teamId || null,
        escalationPolicyId: escalationPolicyId || null,
      },
    });

    await logAudit({
      action: 'service.updated',
      entityType: 'SERVICE',
      entityId: serviceId,
      actorId: currentUser.id,
      details: {
        name: normalizedName,
        teamId: teamId || null,
        escalationPolicyId: escalationPolicyId || null,
      },
    });

    revalidatePath(`/services/${serviceId}`);
    revalidatePath(`/services/${serviceId}/settings`);
    revalidatePath('/services');
    revalidatePath('/audit');
    redirect(serviceSettingsRedirect(serviceId));
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect(`/services/${serviceId}?tab=settings&error=duplicate-service`);
    }

    throw error;
  }
}

export async function updateServiceNotificationSettings(serviceId: string, formData: FormData) {
  const currentUser = await assertCanModifyService(serviceId);
  const channels = parseServiceNotificationChannels(formData);
  const isSlackEnabled = channels.includes('SLACK');
  const slackChannel = isSlackEnabled
    ? formData.has('slackChannel')
      ? String(formData.get('slackChannel') ?? '').trim() || null
      : undefined
    : null;
  const slackWebhookUrl = isSlackEnabled
    ? formData.has('slackWebhookUrl')
      ? String(formData.get('slackWebhookUrl') ?? '').trim() || null
      : undefined
    : null;

  await prisma.service.update({
    where: { id: serviceId },
    data: {
      serviceNotificationChannels: channels,
      serviceNotifyOnTriggered: formData.get('serviceNotifyOnTriggered') === 'true',
      serviceNotifyOnAck: formData.get('serviceNotifyOnAck') === 'true',
      serviceNotifyOnResolved: formData.get('serviceNotifyOnResolved') === 'true',
      serviceNotifyOnSlaBreach: formData.get('serviceNotifyOnSlaBreach') === 'true',
      ...(slackChannel === undefined ? {} : { slackChannel }),
      ...(slackWebhookUrl === undefined ? {} : { slackWebhookUrl }),
    },
  });

  await logAudit({
    action: 'service.notifications.updated',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: {
      channels,
      slackChannel: slackChannel !== undefined && Boolean(slackChannel),
      slackWebhook: slackWebhookUrl !== undefined && Boolean(slackWebhookUrl),
    },
  });

  revalidatePath(`/services/${serviceId}`);
  redirect(serviceSettingsRedirect(serviceId));
}

export async function updateServiceChatOpsSettings(serviceId: string, formData: FormData) {
  const currentUser = await assertCanModifyService(serviceId);
  const bridge = String(formData.get('warRoomVideoBridge') ?? 'INHERIT');
  const warRoomVideoBridge = bridge === 'INHERIT' ? null : bridge;
  const warRoomCustomBridgeUrl =
    String(formData.get('warRoomCustomBridgeUrl') ?? '').trim() || null;

  await prisma.service.update({
    where: { id: serviceId },
    data: {
      autoCreateWarRoom: formData.get('autoCreateWarRoom') === 'on',
      warRoomVideoBridge,
      warRoomCustomBridgeUrl,
    },
  });

  await logAudit({
    action: 'service.chatops.updated',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: { warRoomVideoBridge, hasCustomBridgeUrl: Boolean(warRoomCustomBridgeUrl) },
  });

  revalidatePath(`/services/${serviceId}`);
  redirect(serviceSettingsRedirect(serviceId));
}

export async function saveJiraServiceMapping(
  _prevState: { success?: boolean; error?: string | null } | undefined,
  formData: FormData
): Promise<{ success?: boolean; error?: string | null }> {
  let currentUser: { id: string } | null = null;
  try {
    const serviceId = ((formData.get('serviceId') as string | null) ?? '').trim();
    currentUser = await assertCanModifyService(serviceId);
    const projectKey = assertJiraProjectKey((formData.get('projectKey') as string | null) ?? '');
    const incidentIssueType = assertJiraIssueType(
      (formData.get('incidentIssueType') as string | null) ?? '',
      'Incident issue type'
    );
    const actionItemIssueType = assertJiraIssueType(
      (formData.get('actionItemIssueType') as string | null) ?? '',
      'Action item issue type'
    );
    const defaultLabels = parseLabels((formData.get('defaultLabels') as string | null) ?? '');
    const defaultComponent =
      ((formData.get('defaultComponent') as string | null) ?? '').trim() || null;
    const autoCreateIncidentIssue = formData.get('autoCreateIncidentIssue') === 'on';
    const autoCreateIncidentUrgencies = formData
      .getAll('autoCreateIncidentUrgencies')
      .map(value => String(value).trim().toUpperCase())
      .filter(value => JIRA_AUTO_CREATE_URGENCIES.has(value));
    const syncEnabled = formData.get('syncEnabled') === 'on';

    if (autoCreateIncidentIssue && autoCreateIncidentUrgencies.length === 0) {
      return {
        error:
          'Select at least one incident urgency for Jira auto-create, or turn auto-create off.',
      };
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });
    if (!service) return { error: 'Service not found.' };

    await prisma.jiraServiceMapping.upsert({
      where: { serviceId },
      create: {
        serviceId,
        projectKey,
        incidentIssueType,
        actionItemIssueType,
        defaultLabels,
        defaultComponent,
        autoCreateIncidentIssue,
        autoCreateIncidentUrgencies,
        syncEnabled,
      },
      update: {
        projectKey,
        incidentIssueType,
        actionItemIssueType,
        defaultLabels,
        defaultComponent,
        autoCreateIncidentIssue,
        autoCreateIncidentUrgencies,
        syncEnabled,
      },
    });

    await logAudit({
      action: 'jira.service_mapping.updated',
      entityType: 'SERVICE',
      entityId: serviceId,
      actorId: currentUser.id,
      details: {
        projectKey,
        incidentIssueType,
        actionItemIssueType,
        defaultLabels,
        defaultComponent,
        autoCreateIncidentIssue,
        autoCreateIncidentUrgencies,
        syncEnabled,
      },
    });

    revalidatePath(`/services/${serviceId}/settings`);
    revalidatePath(`/services/${serviceId}`);

    return { success: true, error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to save Jira mapping.' };
  }
}

export async function rotateIntegrationSecret(integrationId: string, serviceId: string) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertCanModifyService(serviceId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const signatureSecret = randomBytes(32).toString('hex');

  await prisma.integration.update({
    where: { id: integrationId, serviceId },
    data: { signatureSecret: await encrypt(signatureSecret) },
  });

  await logAudit({
    action: 'integration.secret_rotated',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: { integrationId },
  });

  revalidatePath(`/services/${serviceId}/integrations`);
  return { secret: signatureSecret };
}

export async function clearIntegrationSecret(integrationId: string, serviceId: string) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertCanModifyService(serviceId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  await prisma.integration.update({
    where: { id: integrationId, serviceId },
    data: { signatureSecret: null },
  });

  await logAudit({
    action: 'integration.secret_cleared',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: { integrationId },
  });

  revalidatePath(`/services/${serviceId}/integrations`);
}

export async function toggleIntegrationStatus(
  integrationId: string,
  serviceId: string,
  enabled: boolean
) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertCanModifyService(serviceId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  await prisma.integration.update({
    where: { id: integrationId, serviceId },
    data: { enabled },
  });

  await logAudit({
    action: 'integration.status_updated',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: { integrationId, enabled },
  });

  revalidatePath(`/services/${serviceId}/integrations`);
}

export async function deleteService(serviceId: string) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Unauthorized. Admin access required.'
    );
  }
  if (!serviceId) return;

  // Incident history is an audit record and must never be erased as a side effect of
  // deleting a service. Require explicit archival/reassignment before deletion.
  const incidentCount = await prisma.incident.count({ where: { serviceId } });
  if (incidentCount > 0) {
    throw new Error(
      `Cannot delete this service while it has ${incidentCount} incident(s). Preserve or reassign the incident history first.`
    );
  }

  // Now delete the service
  await prisma.service.delete({
    where: { id: serviceId },
  });

  await logAudit({
    action: 'service.deleted',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: { serviceId },
  });

  revalidatePath('/services');
  revalidatePath('/incidents');
  revalidatePath('/audit');

  redirect('/services');
}
