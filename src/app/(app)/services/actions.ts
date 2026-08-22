'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { randomBytes } from 'crypto';
import { getDefaultActorId, logAudit } from '@/lib/audit';
import { assertAdminOrResponder, assertAdmin } from '@/lib/rbac';
import { assertServiceNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import { assertJiraIssueType, assertJiraProjectKey, parseLabels } from '@/lib/jira-validation';

const JIRA_AUTO_CREATE_URGENCIES = new Set(['HIGH', 'MEDIUM', 'LOW']);

export async function createIntegration(formData: FormData) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }
  const serviceId = formData.get('serviceId') as string;
  const name = formData.get('name') as string;
  const type = (formData.get('type') as string) || 'EVENTS_API_V2';

  if (!serviceId || !name) {
    throw new Error('Missing required fields');
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
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  await prisma.integration.delete({
    where: { id: integrationId },
  });

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
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }
  const rawName = formData.get('name');
  const name = typeof rawName === 'string' ? rawName : '';
  const description = formData.get('description') as string;
  const region = formData.get('region') as string;
  const slaTier = formData.get('slaTier') as string;
  const slackWebhookUrl = formData.get('slackWebhookUrl') as string;
  const slackChannel = formData.get('slackChannel') as string;
  const teamId = formData.get('teamId') as string;
  const escalationPolicyId = formData.get('escalationPolicyId') as string;

  // Notification preferences
  const serviceNotifyOnTriggered = formData.get('serviceNotifyOnTriggered') === 'true';
  const serviceNotifyOnAck = formData.get('serviceNotifyOnAck') === 'true';
  const serviceNotifyOnResolved = formData.get('serviceNotifyOnResolved') === 'true';
  const serviceNotifyOnSlaBreach = formData.get('serviceNotifyOnSlaBreach') === 'true';

  // Get service notification channels (isolated from escalation)
  // Filter to only valid NotificationChannel enum values
  const allChannels = formData.getAll('serviceNotificationChannels') as string[];
  const validChannels = ['SLACK', 'WEBHOOK', 'EMAIL', 'SMS', 'PUSH', 'WHATSAPP'];
  const serviceNotificationChannels = allChannels.filter(
    ch => validChannels.includes(ch) && !ch.includes(',')
  );

  // ChatOps war-room overrides
  const autoCreateWarRoomValue = formData.get('autoCreateWarRoom');
  const autoCreateWarRoom = autoCreateWarRoomValue === 'on' || autoCreateWarRoomValue === 'true';
  const warRoomVideoBridgeRaw = formData.get('warRoomVideoBridge') as string | null;
  const warRoomVideoBridge =
    warRoomVideoBridgeRaw && warRoomVideoBridgeRaw !== 'INHERIT' ? warRoomVideoBridgeRaw : null;
  const warRoomCustomBridgeUrl =
    ((formData.get('warRoomCustomBridgeUrl') as string | null) ?? '').trim() || null;

  try {
    const normalizedName = await assertServiceNameAvailable(name, { excludeId: serviceId });

    await prisma.service.update({
      where: { id: serviceId },
      data: {
        name: normalizedName,
        description,
        region: region || null,
        slaTier: slaTier || null,
        slackWebhookUrl: slackWebhookUrl || null,
        slackChannel: slackChannel || null,
        teamId: teamId || null,
        escalationPolicyId: escalationPolicyId || null,
        serviceNotificationChannels:
          serviceNotificationChannels.length > 0
            ? (serviceNotificationChannels as any[]) // eslint-disable-line @typescript-eslint/no-explicit-any
            : [], // Default: no channels selected
        serviceNotifyOnTriggered,
        serviceNotifyOnAck,
        serviceNotifyOnResolved,
        serviceNotifyOnSlaBreach,
        autoCreateWarRoom,
        warRoomVideoBridge,
        warRoomCustomBridgeUrl,
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
    redirect(`/services/${serviceId}/settings?saved=1`);
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect(`/services/${serviceId}/settings?error=duplicate-service`);
    }

    throw error;
  }
}

export async function saveJiraServiceMapping(
  _prevState: { success?: boolean; error?: string | null } | undefined,
  formData: FormData
): Promise<{ success?: boolean; error?: string | null }> {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unauthorized' };
  }

  try {
    const serviceId = ((formData.get('serviceId') as string | null) ?? '').trim();
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
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const signatureSecret = randomBytes(32).toString('hex');

  await prisma.integration.update({
    where: { id: integrationId },
    data: { signatureSecret },
  });

  await logAudit({
    action: 'integration.secret_rotated',
    entityType: 'SERVICE',
    entityId: serviceId,
    actorId: currentUser.id,
    details: { integrationId },
  });

  revalidatePath(`/services/${serviceId}/integrations`);
}

export async function clearIntegrationSecret(integrationId: string, serviceId: string) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  await prisma.integration.update({
    where: { id: integrationId },
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
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  await prisma.integration.update({
    where: { id: integrationId },
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

  // Cascade delete is configured in schema, so deleting the service will automatically
  // delete related incidents, alerts, integrations, etc.
  // No need to manually delete them

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
