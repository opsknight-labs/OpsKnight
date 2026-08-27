'use server';

import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { revalidatePath } from 'next/cache';
import { IncidentStatus, IncidentUrgency } from '@prisma/client';
import {
  getCurrentUser,
  assertResponderOrAbove,
  assertCanModifyIncident,
  assertCanCreateIncidentForService,
} from '@/lib/rbac';
import { getUserFriendlyError } from '@/lib/user-friendly-errors';
import { logger } from '@/lib/logger';

const allowedUrgencies = new Set<IncidentUrgency>(['LOW', 'MEDIUM', 'HIGH']);

function parseIncidentUrgency(value: string): IncidentUrgency {
  if (allowedUrgencies.has(value as IncidentUrgency)) {
    return value as IncidentUrgency;
  }
  throw new Error('Invalid incident urgency.');
}

async function assertRequiredCustomFieldsPresent(
  tx: Parameters<Parameters<typeof runSerializableTransaction>[0]>[0],
  incidentId: string
) {
  const missing = await tx.customField.findMany({
    where: {
      required: true,
      values: { none: { incidentId, value: { not: '' } } },
    },
    select: { name: true },
  });
  if (missing.length > 0) {
    throw new Error(
      `Complete required custom fields before resolving: ${missing.map(field => field.name).join(', ')}`
    );
  }
}

export async function updateIncidentStatus(
  id: string,
  status: IncidentStatus,
  expectedStatus?: IncidentStatus
) {
  try {
    // Check resource-level authorization
    await assertCanModifyIncident(id);
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }
  const transition = await runSerializableTransaction(async tx => {
    // Get current incident to check if we're setting acknowledgedAt for the first time
    const incident = await tx.incident.findUnique({
      where: { id },
      select: { status: true, acknowledgedAt: true, resolvedAt: true, currentEscalationStep: true },
    });

    if (!incident) {
      throw new Error(getUserFriendlyError('Incident not found.'));
    }
    // A retry whose desired result already exists is successful even if its
    // expected source state is now stale because the first attempt committed.
    if (incident.status === status) {
      return { previousStatus: incident.status, changed: false };
    }
    if (expectedStatus && incident.status !== expectedStatus) {
      throw new Error(
        `Incident changed from ${expectedStatus} to ${incident.status}; refresh before applying this update.`
      );
    }
    if (incident.status === 'RESOLVED' && status === 'ACKNOWLEDGED') {
      throw new Error('A resolved incident cannot be acknowledged. Reopen it explicitly first.');
    }
    if (status === 'RESOLVED') await assertRequiredCustomFieldsPresent(tx, id);

    // Build update data
    const updateData: any = {
      status,
      // Track SLA timestamps
      ...(status === 'ACKNOWLEDGED' && !incident.acknowledgedAt
        ? {
            acknowledgedAt: new Date(),
          }
        : {}),
      ...(status === 'RESOLVED' && !incident.resolvedAt
        ? {
            resolvedAt: new Date(),
          }
        : {}),
      ...(incident.status === 'RESOLVED' && status !== 'RESOLVED'
        ? {
            resolvedAt: null,
          }
        : {}),
      events: {
        create: {
          type:
            status === 'ACKNOWLEDGED'
              ? 'ACKNOWLEDGED'
              : status === 'RESOLVED'
                ? 'MANUAL_RESOLVED'
                : 'STATUS_CHANGE',
          message:
            status === 'SNOOZED'
              ? 'Incident snoozed (escalation paused)'
              : status === 'SUPPRESSED'
                ? 'Incident suppressed (escalation paused)'
                : status === 'OPEN' && incident.status === 'ACKNOWLEDGED'
                  ? 'Incident unacknowledged (escalation resumed)'
                  : status === 'OPEN' &&
                      (incident.status === 'SNOOZED' || incident.status === 'SUPPRESSED')
                    ? 'Incident unsnoozed/unsuppressed (escalation resumed)'
                    : `Status updated to ${status}${status === 'ACKNOWLEDGED' || status === 'RESOLVED' ? ' (escalation stopped)' : ''}`,
        },
      },
    };

    // Handle escalation status based on new status
    if (status === 'ACKNOWLEDGED' || status === 'RESOLVED') {
      // Completed - stop escalation permanently
      updateData.escalationStatus = 'COMPLETED';
      updateData.nextEscalationAt = null;
    } else if (status === 'SNOOZED' || status === 'SUPPRESSED') {
      // Paused - stop escalation temporarily
      updateData.escalationStatus = 'PAUSED';
      updateData.nextEscalationAt = null;
    } else if (status === 'OPEN') {
      // Resuming from any paused state - resume escalation
      if (
        incident.status === 'SNOOZED' ||
        incident.status === 'SUPPRESSED' ||
        incident.status === 'ACKNOWLEDGED' ||
        incident.status === 'RESOLVED'
      ) {
        updateData.escalationStatus = 'ESCALATING';
        if (incident.status === 'ACKNOWLEDGED' || incident.status === 'RESOLVED') {
          const policyData = await tx.incident.findUnique({
            where: { id },
            select: {
              currentEscalationStep: true,
              service: {
                select: {
                  policy: {
                    select: {
                      steps: {
                        orderBy: { stepOrder: 'asc' },
                        select: { delayMinutes: true },
                      },
                    },
                  },
                },
              },
            },
          });

          if (incident.status === 'RESOLVED') {
            updateData.resolvedAt = null;
            updateData.currentEscalationStep = 0;
            const step0Delay = policyData?.service?.policy?.steps?.[0]?.delayMinutes ?? 0;
            updateData.nextEscalationAt =
              step0Delay > 0 ? new Date(Date.now() + step0Delay * 60 * 1000) : new Date();
          } else {
            const stepIndex = policyData?.currentEscalationStep ?? 0;
            const delayMinutes = policyData?.service?.policy?.steps?.[stepIndex]?.delayMinutes ?? 0;
            updateData.nextEscalationAt = new Date(Date.now() + delayMinutes * 60 * 1000);
          }
        } else {
          updateData.nextEscalationAt = new Date(); // Resume immediately
        }
      }
    }

    await tx.incident.update({
      where: { id },
      data: updateData,
    });

    return { previousStatus: incident.status, changed: true };
  });

  if (!transition.changed) {
    return;
  }

  // Send service-level notifications for status changes
  // Uses user preferences for each recipient
  try {
    const { sendIncidentNotifications } = await import('@/lib/user-notifications');
    if (status === 'ACKNOWLEDGED') {
      await sendIncidentNotifications(id, 'acknowledged');
    } else if (status === 'RESOLVED') {
      await sendIncidentNotifications(id, 'resolved');
    } else if (status === 'OPEN' && transition.previousStatus !== 'OPEN') {
      // Status changed to OPEN (e.g., from snoozed/acknowledged)
      await sendIncidentNotifications(id, 'updated');
    }
  } catch (e) {
    logger.error('Service notification failed', {
      component: 'incidents-actions',
      error: e,
      incidentId: id,
    });
  }

  // Notify status page subscribers (Email)
  try {
    const { scheduleStatusPageNotification } = await import('@/lib/jobs/queue');
    const eventMap: Record<string, string> = {
      ACKNOWLEDGED: 'acknowledged',
      RESOLVED: 'resolved',
      OPEN: 'investigating', // Re-opened or opened
      SNOOZED: 'snoozed',
      SUPPRESSED: 'suppressed',
    };
    const notifyEvent = eventMap[status];
    if (notifyEvent) {
      await scheduleStatusPageNotification(id, notifyEvent);
    }
  } catch (e) {
    logger.error('Status page subscriber notification failed', {
      component: 'incidents-actions',
      error: e,
      incidentId: id,
    });
  }

  // ChatOps: Archive war-room channel on resolve (best-effort)
  if (status === 'RESOLVED') {
    try {
      const { archiveWarRoomChannel } = await import('@/lib/chatops/war-room');
      archiveWarRoomChannel(id).catch(err =>
        logger.error('ChatOps war-room archive failed', {
          component: 'incidents-actions',
          error: err,
          incidentId: id,
        })
      );
    } catch (e) {
      logger.error('Failed to load chatops/war-room', { error: e });
    }
  }

  // ChatOps: Sync status changes & update topic in war-room (best-effort)
  if (status !== 'RESOLVED') {
    try {
      const { postWarRoomUpdate, updateWarRoomTopic } = await import('@/lib/chatops/war-room');
      const statusEmoji: Record<string, string> = {
        ACKNOWLEDGED: '👀',
        OPEN: '🔄',
        SNOOZED: '😴',
        SUPPRESSED: '🔇',
      };
      postWarRoomUpdate(id, `${statusEmoji[status] || '📋'} *Status updated to ${status}*`).catch(
        err =>
          logger.error('ChatOps status sync failed', {
            component: 'incidents-actions',
            error: err,
            incidentId: id,
          })
      );
      updateWarRoomTopic(id, status).catch(() => {});
    } catch (e) {
      logger.error('Failed to load chatops/war-room', { error: e });
    }
  }

  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
  revalidatePath('/');
}

export async function resolveIncidentWithNote(id: string, resolution: string) {
  try {
    // Check resource-level authorization
    await assertCanModifyIncident(id);
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }
  const trimmedResolution = resolution?.trim();
  const minLength = 10;
  const maxLength = 1000;

  if (!trimmedResolution || trimmedResolution.length < minLength) {
    throw new Error(
      `Resolution note must be at least ${minLength} characters. Please provide more details about how the incident was resolved.`
    );
  }

  if (trimmedResolution.length > maxLength) {
    throw new Error(
      `Resolution note must be ${maxLength} characters or fewer. Please shorten your description.`
    );
  }
  const user = await getCurrentUser();

  const resolvedNow = await runSerializableTransaction(async tx => {
    // Get current incident to check if we're setting resolvedAt for the first time
    const currentIncident = await tx.incident.findUnique({ where: { id } });
    if (!currentIncident) {
      throw new Error(getUserFriendlyError('Incident not found.'));
    }

    // Idempotency check: If already resolved, prevent duplicate resolution notes
    if (currentIncident.status === 'RESOLVED') {
      return false;
    }
    await assertRequiredCustomFieldsPresent(tx, id);

    await tx.incident.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        // Stop escalation when resolved
        escalationStatus: 'COMPLETED',
        nextEscalationAt: null,
        // Track SLA timestamp
        ...(!currentIncident.resolvedAt
          ? {
              resolvedAt: new Date(),
            }
          : {}),
        events: {
          create: {
            type: 'MANUAL_RESOLVED',
            message: trimmedResolution
              ? `Resolved: ${trimmedResolution}`
              : 'Resolved (escalation stopped)',
          },
        },
      },
    });

    if (trimmedResolution && user) {
      await tx.incidentNote.create({
        data: {
          incidentId: id,
          userId: user.id,
          content: `Resolution: ${trimmedResolution}`,
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId: id,
          type: 'COMMENT',
          message: `Resolution note added by ${user.name}`,
        },
      });
    }

    return true;
  });

  if (!resolvedNow) {
    return;
  }

  // Send service-level notifications for resolution
  // Uses user preferences for each recipient
  try {
    const { sendIncidentNotifications } = await import('@/lib/user-notifications');
    await sendIncidentNotifications(id, 'resolved');
  } catch (e) {
    logger.error('Service notification failed', {
      component: 'incidents-actions',
      error: e,
      incidentId: id,
    });
  }

  // Notify status page subscribers (Email)
  try {
    const { scheduleStatusPageNotification } = await import('@/lib/jobs/queue');
    await scheduleStatusPageNotification(id, 'resolved');
  } catch (e) {
    logger.error('Status page subscriber notification failed', {
      component: 'incidents-actions',
      error: e,
      incidentId: id,
    });
  }

  // ChatOps: Archive war-room channel on resolve (best-effort)
  try {
    const { archiveWarRoomChannel } = await import('@/lib/chatops/war-room');
    await archiveWarRoomChannel(id);
  } catch (e) {
    logger.error('ChatOps war-room archive failed', {
      component: 'incidents-actions',
      error: e,
      incidentId: id,
    });
  }

  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
  revalidatePath('/');
}

export async function updateIncidentUrgency(id: string, urgency: string) {
  try {
    // Check resource-level authorization
    await assertCanModifyIncident(id);
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }
  const parsedUrgency = parseIncidentUrgency(urgency);
  await prisma.incident.update({
    where: { id },
    data: {
      urgency: parsedUrgency,
      events: {
        create: {
          type: 'STATUS_CHANGE',
          message: `Urgency updated to ${parsedUrgency}`,
        },
      },
    },
  });

  // ChatOps: Sync urgency change to war-room (best-effort)
  try {
    const { postWarRoomUpdate } = await import('@/lib/chatops/war-room');
    postWarRoomUpdate(id, `🔔 *Urgency updated to ${parsedUrgency}*`).catch(err =>
      logger.error('ChatOps urgency sync failed', {
        component: 'incidents-actions',
        error: err,
        incidentId: id,
      })
    );
  } catch (e) {
    logger.error('Failed to load chatops/war-room', { error: e });
  }

  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
  revalidatePath('/');
}

export async function updateIncidentPriority(id: string, priority: string | null) {
  try {
    await assertCanModifyIncident(id);
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }

  await prisma.incident.update({
    where: { id },
    data: {
      priority,
      events: {
        create: {
          type: 'STATUS_CHANGE',
          message: priority ? `Priority updated to ${priority}` : 'Priority cleared (Unassigned)',
        },
      },
    },
  });

  // ChatOps: Sync priority change to war-room (best-effort)
  try {
    const { postWarRoomUpdate } = await import('@/lib/chatops/war-room');
    postWarRoomUpdate(id, `🎯 *Priority updated to ${priority || 'Unassigned'}*`).catch(err =>
      logger.error('ChatOps priority sync failed', {
        component: 'incidents-actions',
        error: err,
        incidentId: id,
      })
    );
  } catch (e) {
    logger.error('Failed to load chatops/war-room', { error: e });
  }

  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
  revalidatePath('/');
}

export async function createIncident(formData: FormData) {
  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const urgency = parseIncidentUrgency(formData.get('urgency') as string);
  const serviceId = formData.get('serviceId') as string;
  try {
    await assertCanCreateIncidentForService(serviceId);
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }
  const priority = formData.get('priority') as string | null;
  const dedupKey = formData.get('dedupKey') as string | null;
  const assigneeId = formData.get('assigneeId') as string | null;

  // Extract custom field values (deduplicated by fieldId)
  const customFieldMap = new Map<string, string>();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('customField_')) {
      const fieldId = key.replace('customField_', '');
      const fieldValue = value as string;
      if (fieldValue && fieldValue.trim()) {
        customFieldMap.set(fieldId, fieldValue.trim());
      }
    }
  }
  const customFields = await prisma.customField.findMany({ orderBy: { order: 'asc' } });
  const knownFieldIds = new Set(customFields.map(field => field.id));
  if (Array.from(customFieldMap.keys()).some(fieldId => !knownFieldIds.has(fieldId))) {
    throw new Error('One or more custom fields are invalid. Refresh the form and try again.');
  }
  const { validateCustomFieldValue } = await import('@/lib/custom-fields');
  const customFieldEntries = customFields.flatMap(field => {
    const supplied = customFieldMap.get(field.id) ?? field.defaultValue;
    const validation = validateCustomFieldValue(field, supplied);
    if (!validation.valid) throw new Error(validation.error || `Invalid ${field.name}`);
    return validation.normalizedValue === null
      ? []
      : [{ fieldId: field.id, value: validation.normalizedValue }];
  });

  const teamId = formData.get('teamId') as string | null;
  const visibility = (formData.get('visibility') as 'PUBLIC' | 'PRIVATE') || 'PUBLIC';

  const incident = await runSerializableTransaction(async tx => {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('User session not found. Please sign in again.');
    }

    let assigneeName: string | null = null;
    if (assigneeId && assigneeId.length) {
      const assignee = await tx.user.findUnique({
        where: { id: assigneeId },
        select: { name: true },
      });
      assigneeName = assignee?.name || null;
    }

    // Intelligent Deduplication & Merging Logic
    if (dedupKey && dedupKey.length > 0) {
      // 1. Check for existing OPEN/ACKNOWLEDGED incident
      const existingOpenIncident = await tx.incident.findFirst({
        where: {
          dedupKey,
          serviceId,
          status: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED'] },
        },
      });

      if (existingOpenIncident) {
        // MERGE: Add as a note to the existing incident
        await tx.incidentNote.create({
          data: {
            incidentId: existingOpenIncident.id,
            userId: currentUser.id,
            content: `[Manual Report Merged] User reported recurrence.\n\nTitle: ${title}\nDescription: ${description}`,
          },
        });

        await tx.incidentEvent.create({
          data: {
            incidentId: existingOpenIncident.id,
            type: 'COMMENT',
            message: `Manual report merged from user.`,
          },
        });

        return existingOpenIncident; // Redirect user to the existing incident
      }

      // 2. Check for RECENTLY RESOLVED incident (Re-open window: 30 mins)
      const REOPEN_WINDOW_MS = 30 * 60 * 1000;
      const recentResolvedIncident = await tx.incident.findFirst({
        where: {
          dedupKey,
          serviceId,
          status: 'RESOLVED',
          resolvedAt: {
            gt: new Date(Date.now() - REOPEN_WINDOW_MS),
          },
        },
        orderBy: { resolvedAt: 'desc' }, // Get the most recently resolved one
      });

      if (recentResolvedIncident) {
        // RE-OPEN: Update status to OPEN
        const reOpenedIncident = await tx.incident.update({
          where: { id: recentResolvedIncident.id },
          data: {
            status: 'OPEN',
            resolvedAt: null, // Clear resolution time
            escalationStatus: 'ESCALATING',
            nextEscalationAt: new Date(),
            currentEscalationStep: 0,
            events: {
              create: {
                type: 'REOPENED',
                message: `Incident re-opened due to manual report within 30m window.\nSummary: ${title}`,
              },
            },
          },
        });

        await tx.incidentNote.create({
          data: {
            incidentId: reOpenedIncident.id,
            userId: currentUser.id,
            content: `[Re-opened] User reported recurrence.\n\nTitle: ${title}\nDescription: ${description}`,
          },
        });

        return reOpenedIncident;
      }
    }

    const createdIncident = await tx.incident.create({
      data: {
        title,
        description,
        urgency,
        serviceId,

        visibility,
        priority: priority && priority.length ? priority : null,
        dedupKey: dedupKey && dedupKey.length ? dedupKey : null,
        assigneeId: assigneeId && assigneeId.length ? assigneeId : null,
        teamId: !assigneeId && teamId && teamId.length ? teamId : null,
        events: {
          create: {
            type: 'LEGACY_OTHER',
            message: assigneeId
              ? `Incident created with ${urgency} urgency and assigned to ${assigneeName || 'user'}`
              : teamId
                ? `Incident created with ${urgency} urgency and assigned to team`
                : `Incident created with ${urgency} urgency`,
          },
        },
        // Create custom field values
        customFieldValues: {
          create: customFieldEntries.map(({ fieldId, value }) => ({
            customFieldId: fieldId,
            value,
          })),
        },
      },
    });

    return createdIncident;
  });

  // If we reopened a recently resolved incident, immediately schedule the first escalation step
  if (
    incident.status === 'OPEN' &&
    incident.resolvedAt === null &&
    incident.currentEscalationStep === 0
  ) {
    try {
      const { scheduleEscalation } = await import('@/lib/jobs/queue');
      // Retry up to 3 times with short backoff to ensure the first escalation job is queued
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await scheduleEscalation(incident.id, 0, 0);
          break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise(res => setTimeout(res, 200 * Math.pow(2, attempt)));
        }
      }
    } catch (e) {
      logger.error('Failed to schedule escalation after reopen', {
        component: 'incidents-actions',
        error: e,
        incidentId: incident.id,
      });
    }
  }

  // Execute escalation policy if service has one
  let escalationResult: { escalated?: boolean; reason?: string } | null = null;
  try {
    const { executeEscalation } = await import('@/lib/escalation');
    escalationResult = await executeEscalation(incident.id);
  } catch (e) {
    logger.error('Escalation failed', {
      component: 'incidents-actions',
      error: e,
      incidentId: incident.id,
    });
  }

  const hasEscalationPolicy = escalationResult?.reason !== 'No escalation policy configured';

  // Send service-level notifications for new incident (Slack/Webhook only),
  // or fall back to user notifications when no policy is configured.
  try {
    if (hasEscalationPolicy) {
      const { sendServiceNotifications } = await import('@/lib/service-notifications');
      await sendServiceNotifications(incident.id, 'triggered');
    } else {
      const { sendIncidentNotifications } = await import('@/lib/user-notifications');
      await sendIncidentNotifications(incident.id, 'triggered');
    }
  } catch (e) {
    logger.error('Service notification failed', {
      component: 'incidents-actions',
      error: e,
      incidentId: incident.id,
    });
  }

  // Notify status page subscribers (Email)
  try {
    const { scheduleStatusPageNotification } = await import('@/lib/jobs/queue');
    await scheduleStatusPageNotification(incident.id, 'triggered');
  } catch (e) {
    logger.error('Status page subscriber notification failed', {
      component: 'incidents-actions',
      error: e,
      incidentId: incident.id,
    });
  }

  // Optional Jira automation. This is intentionally best-effort so Jira
  // outages never block incident creation during rolling deployments.
  try {
    const incidentForJira = await prisma.incident.findUnique({
      where: { id: incident.id },
      include: {
        service: { include: { jiraServiceMapping: true } },
        externalIssueLinks: { where: { provider: 'JIRA' }, select: { id: true } },
      },
    });

    const mapping = incidentForJira?.service?.jiraServiceMapping;
    if (
      incidentForJira &&
      mapping?.autoCreateIncidentIssue &&
      (mapping.autoCreateIncidentUrgencies.length === 0 ||
        mapping.autoCreateIncidentUrgencies.includes(incidentForJira.urgency)) &&
      incidentForJira.externalIssueLinks.length === 0
    ) {
      const jiraConfig = await prisma.jiraConfig.findUnique({
        where: { id: 'default' },
        select: { enabled: true },
      });

      if (jiraConfig?.enabled) {
        const { createJiraIssueAndLink } = await import('@/lib/jira-sync');
        const { issue } = await createJiraIssueAndLink({
          incidentId: incident.id,
          projectKey: mapping.projectKey,
          issueType: mapping.incidentIssueType || 'Bug',
          summary: `[Incident] ${incidentForJira.title}`,
          description:
            incidentForJira.description || `OpsKnight Incident: ${incidentForJira.title}`,
          labels: mapping.defaultLabels.length > 0 ? mapping.defaultLabels : ['opsknight'],
          component: mapping.defaultComponent,
        });

        await prisma.incidentEvent.create({
          data: {
            incidentId: incident.id,
            type: 'LEGACY_OTHER',
            message: `Jira issue ${issue.key} auto-created`,
          },
        });
      }
    }
  } catch (e) {
    logger.error('Jira issue auto-create failed', {
      component: 'incidents-actions',
      error: e,
      incidentId: incident.id,
    });
  }

  // ChatOps: Auto-create war-room for qualifying incidents (best-effort)
  try {
    const { createIncidentWarRoom } = await import('@/lib/chatops/war-room');
    await createIncidentWarRoom(incident.id).catch(err => {
      logger.error('ChatOps war-room creation failed', {
        component: 'incidents-actions',
        error: err instanceof Error ? err.message : String(err),
        incidentId: incident.id,
      });
    });
  } catch (e) {
    logger.error('Failed to load chatops/war-room', { error: e });
  }

  // Revalidate all relevant paths to ensure UI shows updated assignee
  revalidatePath('/incidents');
  revalidatePath(`/incidents/${incident.id}`);
  revalidatePath('/');

  // Return the incident ID so the client can handle redirection (context-aware)
  return { id: incident.id };
}

export async function addNote(incidentId: string, content: string) {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }
  await assertCanModifyIncident(incidentId);
  const user = await getCurrentUser();

  await prisma.$transaction(async tx => {
    await tx.incidentNote.create({
      data: {
        incidentId,
        userId: user.id,
        content,
      },
    });

    await tx.incidentEvent.create({
      data: {
        incidentId,
        type: 'COMMENT',
        message: `Note added by ${user.name}`,
      },
    });
  });

  revalidatePath(`/incidents/${incidentId}`);

  // Best-effort sync note to any linked Jira tickets
  try {
    const { syncIncidentNoteToJira } = await import('@/lib/jira-sync');
    await syncIncidentNoteToJira(incidentId, user.name, content);
  } catch (e) {
    logger.error('Jira note sync failed', { component: 'incidents-actions', error: e, incidentId });
  }

  // Best-effort sync note to war-room channel
  try {
    const { postWarRoomUpdate } = await import('@/lib/chatops/war-room');
    await postWarRoomUpdate(incidentId, `📝 *Note by ${user.name}:*\n> ${content}`);
  } catch (e) {
    logger.error('ChatOps note sync failed', {
      component: 'incidents-actions',
      error: e,
      incidentId,
    });
  }
}

export async function reassignIncident(incidentId: string, assigneeId: string, teamId?: string) {
  try {
    // Check resource-level authorization
    await assertCanModifyIncident(incidentId);
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }

  // Handle unassigning (empty assigneeId and teamId)
  if ((!assigneeId || assigneeId.trim() === '') && (!teamId || teamId.trim() === '')) {
    await prisma.$transaction(async tx => {
      await tx.incident.update({
        where: { id: incidentId },
        data: {
          assigneeId: null,
          teamId: null,
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          type: 'ASSIGNMENT',
          message: 'Incident unassigned',
        },
      });
    });

    // ChatOps: Sync unassignment & update topic in war-room
    try {
      const { postWarRoomUpdate, updateWarRoomTopic } = await import('@/lib/chatops/war-room');
      postWarRoomUpdate(incidentId, '👤 *Incident unassigned*').catch(() => {});
      updateWarRoomTopic(incidentId).catch(() => {});
    } catch {} // Best-effort

    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath('/incidents');
    return;
  }

  // Handle assigning to team
  if (teamId && teamId.trim() !== '') {
    await prisma.$transaction(async tx => {
      const teamRecord = await tx.team.findUnique({
        where: { id: teamId },
        select: { name: true },
      });
      if (!teamRecord) {
        throw new Error(
          getUserFriendlyError('Team not found. The selected team may have been deleted.')
        );
      }

      await tx.incident.update({
        where: { id: incidentId },
        data: {
          teamId,
          assigneeId: null, // Clear user assignment when assigning to team
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          type: 'ASSIGNMENT',
          message: `Incident assigned to team: ${teamRecord.name}`,
        },
      });
    });

    // Notify all team members
    try {
      const { sendUserNotification } = await import('@/lib/user-notifications');
      const teamWithMembers = await prisma.team.findUnique({
        where: { id: teamId },
        include: {
          members: true,
        },
      });

      if (teamWithMembers) {
        const incident = await prisma.incident.findUnique({
          where: { id: incidentId },
          include: {
            // Fetch service info for notification context
            service: {
              include: {
                team: {
                  include: { members: { include: { user: true } } },
                },
              },
            },
            assignee: true,
          },
        });

        const message = `[OpsKnight] ${incident?.title || 'Incident'} assigned to your team: ${teamWithMembers.name}`;
        for (const member of teamWithMembers.members) {
          await sendUserNotification(incidentId, member.userId, message);
        }

        // --- ADDED: Send Service-Level Notification for Reassignment (Team) ---
        if (incident) {
          const { sendIncidentNotifications } = await import('@/lib/user-notifications');
          // 'updated' is a catch-all that triggers service notifications
          await sendIncidentNotifications(incident.id, 'updated', [], incident);
        }
      }
    } catch (error) {
      logger.error('Failed to notify team members', {
        component: 'incidents-actions',
        error,
        incidentId,
        teamId,
      });
    } // Continue even if notifications fail

    // ChatOps: Sync team assignment, auto-invite members & update topic in war-room
    try {
      const { postWarRoomUpdate, inviteTeamToWarRoom, updateWarRoomTopic } =
        await import('@/lib/chatops/war-room');
      const teamRecord = await prisma.team.findUnique({
        where: { id: teamId },
        select: { name: true },
      });
      postWarRoomUpdate(
        incidentId,
        `👥 *Incident assigned to team: ${teamRecord?.name || 'Unknown'}*`
      ).catch(() => {});
      inviteTeamToWarRoom(incidentId, teamId).catch(() => {});
      updateWarRoomTopic(incidentId).catch(() => {});
    } catch {} // Best-effort

    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath('/incidents');
    return;
  }

  // Handle assigning to a user
  if (assigneeId && assigneeId.trim() !== '') {
    await prisma.$transaction(async tx => {
      const assigneeRecord = await tx.user.findUnique({ where: { id: assigneeId } });
      if (!assigneeRecord) {
        throw new Error(
          getUserFriendlyError('Assignee not found. The selected user may have been deleted.')
        );
      }

      await tx.incident.update({
        where: { id: incidentId },
        data: {
          assigneeId,
          teamId: null, // Clear team assignment when assigning to user
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          type: 'ASSIGNMENT',
          message: `Incident manually reassigned to ${assigneeRecord.name}`,
        },
      });
    });

    // --- ADDED: Send Service-Level Notification for Reassignment (User) ---
    try {
      const { sendIncidentNotifications } = await import('@/lib/user-notifications');
      await sendIncidentNotifications(incidentId, 'updated');
    } catch (error) {
      logger.error('Failed to send reassignment notification', { error, incidentId });
    }

    // ChatOps: Sync user assignment, auto-invite user & update topic in war-room
    try {
      const { postWarRoomUpdate, inviteUserToWarRoom, updateWarRoomTopic } =
        await import('@/lib/chatops/war-room');
      const assignee = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { name: true },
      });
      postWarRoomUpdate(
        incidentId,
        `👤 *Incident reassigned to ${assignee?.name || 'Unknown'}*`
      ).catch(() => {});
      inviteUserToWarRoom(incidentId, assigneeId).catch(() => {});
      updateWarRoomTopic(incidentId).catch(() => {});
    } catch {} // Best-effort

    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath('/incidents');
  }
}

export async function addWatcher(incidentId: string, userId: string, role: string) {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }
  if (!userId) return;

  await prisma.$transaction(async tx => {
    await tx.incidentWatcher.upsert({
      where: {
        incidentId_userId: {
          incidentId,
          userId,
        },
      },
      update: {
        role: role || 'FOLLOWER',
      },
      create: {
        incidentId,
        userId,
        role: role || 'FOLLOWER',
      },
    });

    await tx.incidentEvent.create({
      data: {
        incidentId,
        type: 'LEGACY_OTHER',
        message: `Watcher added (${role || 'FOLLOWER'})`,
      },
    });
  });

  revalidatePath(`/incidents/${incidentId}`);
}

export async function removeWatcher(incidentId: string, watcherId: string) {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }
  await prisma.$transaction(async tx => {
    await tx.incidentWatcher.delete({
      where: { id: watcherId },
    });

    await tx.incidentEvent.create({
      data: {
        incidentId,
        type: 'LEGACY_OTHER',
        message: 'Watcher removed',
      },
    });
  });

  revalidatePath(`/incidents/${incidentId}`);
}

export async function updateIncidentVisibility(id: string, visibility: 'PUBLIC' | 'PRIVATE') {
  try {
    await assertCanModifyIncident(id);
  } catch (error) {
    throw new Error(getUserFriendlyError(error));
  }

  await prisma.incident.update({
    where: { id },
    data: {
      visibility,
      events: {
        create: {
          type: 'STATUS_CHANGE',
          message: `Visibility updated to ${visibility}`,
        },
      },
    },
  });

  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
  revalidatePath('/');
}

export async function getIncidentCreationContext() {
  const { getUserPermissions } = await import('@/lib/rbac');
  const permissions = await getUserPermissions();

  const canCreateIncident = permissions.capabilities.some(
    (capability: string) =>
      capability === 'incident.create.all' || capability === 'incident.create.scoped'
  );

  if (!canCreateIncident) {
    return {
      canCreateIncident: false as const,
      services: [],
      users: [],
      teams: [],
      customFields: [],
      templates: [],
    };
  }

  const { getAllTemplates } = await import('./template-actions');

  const [services, users, customFields, teams, templates] = await Promise.all([
    prisma.service.findMany({ orderBy: { name: 'asc' } }),
    prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, email: true, avatarUrl: true },
      orderBy: { name: 'asc' },
    }),
    prisma.customField.findMany({ orderBy: { order: 'asc' } }),
    prisma.team.findMany({ orderBy: { name: 'asc' } }),
    getAllTemplates(permissions.id),
  ]);

  return {
    canCreateIncident: true as const,
    services,
    users,
    teams,
    customFields,
    templates,
  };
}
