'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { IncidentStatus, IncidentUrgency } from '@prisma/client';
import {
  getCurrentUser,
  assertResponderOrAbove,
  assertCanCreateIncidentForService,
  assertCanAddIncidentNote,
} from '@/lib/rbac';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  updateIncidentStatus as updateIncidentStatusWithLifecycle,
  resolveIncidentWithNote as resolveIncidentWithLifecycleNote,
} from '@/lib/incidents/operator-lifecycle';
import { executeIncidentCreation, type IncidentCreationSource } from '@/lib/incidents/creation';
import { enqueueIncidentUpdateSideEffects } from '@/lib/event-outbox';

const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

const allowedUrgencies = new Set<IncidentUrgency>(['LOW', 'MEDIUM', 'HIGH']);

function parseIncidentUrgency(value: string): IncidentUrgency {
  if (allowedUrgencies.has(value as IncidentUrgency)) {
    return value as IncidentUrgency;
  }
  throw new AppError({
    code: 'INCIDENT_INVALID_ARGUMENT',
    userMessage: 'Invalid incident urgency.',
    fields: [{ field: 'urgency', code: 'invalid', message: 'Invalid incident urgency.' }],
    details: { urgency: value },
  });
}

export async function updateIncidentStatus(
  id: string,
  status: IncidentStatus,
  expectedStatus?: IncidentStatus
) {
  return updateIncidentStatusWithLifecycle(id, status, expectedStatus, 'WEB');
}

export async function resolveIncidentWithNote(id: string, resolution: string) {
  return resolveIncidentWithLifecycleNote(id, resolution, 'WEB');
}

export async function updateIncidentUrgency(id: string, urgency: string) {
  await assertResponderOrAbove();
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
  await assertResponderOrAbove();

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

async function createIncidentFromFormData(formData: FormData, source: IncidentCreationSource) {
  const title = String(formData.get('title') ?? '');
  const description = String(formData.get('description') ?? '');
  const urgency = parseIncidentUrgency(String(formData.get('urgency') ?? ''));
  const serviceId = String(formData.get('serviceId') ?? '');

  if (!serviceId) {
    throw new AppError({
      code: 'INCIDENT_INVALID_ARGUMENT',
      userMessage: 'Please select a service.',
      fields: [{ field: 'serviceId', code: 'required', message: 'Please select a service.' }],
    });
  }

  await assertCanCreateIncidentForService(serviceId);
  const currentUser = await getCurrentUser();

  const customFieldMap = new Map<string, string>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('customField_') || typeof value !== 'string') continue;
    const fieldId = key.slice('customField_'.length);
    const fieldValue = value.trim();
    if (fieldValue) customFieldMap.set(fieldId, fieldValue);
  }

  const rawVisibility = String(formData.get('visibility') ?? 'PUBLIC');
  const result = await executeIncidentCreation({
    title,
    description,
    urgency,
    serviceId,
    priority: String(formData.get('priority') ?? '') || null,
    dedupKey: String(formData.get('dedupKey') ?? '') || null,
    assigneeId: String(formData.get('assigneeId') ?? '') || null,
    teamId: String(formData.get('teamId') ?? '') || null,
    visibility: rawVisibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
    customFields: [...customFieldMap].map(([fieldId, value]) => ({ fieldId, value })),
    source,
    actor: { id: currentUser.id, name: currentUser.name ?? undefined },
  });

  revalidatePath('/incidents');
  revalidatePath(`/incidents/${result.id}`);
  revalidatePath('/');

  return result;
}

export async function createIncident(formData: FormData) {
  return createIncidentFromFormData(formData, 'WEB');
}

export async function createMobileIncident(formData: FormData) {
  return createIncidentFromFormData(formData, 'MOBILE');
}

export async function addNote(incidentId: string, content: string) {
  await assertCanAddIncidentNote(incidentId);
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
  await assertResponderOrAbove();

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
        throw new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: LEGACY_NOT_FOUND_MESSAGE,
          details: { resource: 'team', teamId },
        });
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
      await enqueueIncidentUpdateSideEffects(tx, incidentId, [
        'INCIDENT_ASSIGNED_TO_TEAM_NOTIFICATION',
      ]);
    });

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
        throw new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: LEGACY_NOT_FOUND_MESSAGE,
          details: { resource: 'user', userId: assigneeId },
        });
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
      await enqueueIncidentUpdateSideEffects(tx, incidentId, [
        'INCIDENT_ASSIGNED_TO_USER_NOTIFICATION',
      ]);
    });

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
  await assertResponderOrAbove();
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
  await assertResponderOrAbove();
  await prisma.$transaction(async tx => {
    const removed = await tx.incidentWatcher.deleteMany({
      where: { id: watcherId, incidentId },
    });
    if (removed.count !== 1) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: LEGACY_NOT_FOUND_MESSAGE,
        details: { resource: 'incidentWatcher', incidentId, watcherId },
      });
    }

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
  await assertResponderOrAbove();

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
  const canCreateAll = permissions.capabilities.includes('incident.create.all');
  const canCreateIncident =
    canCreateAll || permissions.capabilities.includes('incident.create.scoped');

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
  const teamScope = canCreateAll ? undefined : { members: { some: { userId: permissions.id } } };
  const [services, users, customFields, teams, templates] = await Promise.all([
    prisma.service.findMany({
      where: canCreateAll ? undefined : { team: teamScope },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        ...(canCreateAll
          ? {}
          : {
              teamMemberships: {
                some: { team: { members: { some: { userId: permissions.id } } } },
              },
            }),
      },
      select: { id: true, name: true, email: true, avatarUrl: true },
      orderBy: { name: 'asc' },
    }),
    prisma.customField.findMany({ orderBy: { order: 'asc' } }),
    prisma.team.findMany({ where: teamScope, orderBy: { name: 'asc' } }),
    getAllTemplates(permissions.id),
  ]);

  return { canCreateIncident: true as const, services, users, teams, customFields, templates };
}
