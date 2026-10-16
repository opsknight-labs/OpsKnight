'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { IncidentStatus, IncidentUrgency } from '@prisma/client';
import {
  getCurrentUser,
  assertResponderOrAbove,
  assertCanCreateIncidentForService,
  assertCanAddIncidentNote,
  assertCanViewIncident,
} from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { AppError } from '@/lib/errors';
import {
  updateIncidentStatus as updateIncidentStatusWithLifecycle,
  resolveIncidentWithNote as resolveIncidentWithLifecycleNote,
} from '@/lib/incidents/operator-lifecycle';
import { executeIncidentCreation, type IncidentCreationSource } from '@/lib/incidents/creation';
import { enqueueWarRoomSideEffects } from '@/lib/event-outbox';
import { reconcileIncidentEngagementAfterUrgencyChange } from '@/lib/incidents/engagement-reconciliation';
import { assignIncidentDomainCommand } from '@/lib/incidents/assignment';
import { setIncidentWatcher, deleteIncidentWatcher } from '@/lib/incidents/watchers';
import { addIncidentNoteDomainCommand } from '@/lib/incidents/notes';

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
  await prisma.$transaction(async tx => {
    const current = await tx.incident.findUniqueOrThrow({
      where: { id },
      select: { urgency: true },
    });
    await tx.incident.update({
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
    await reconcileIncidentEngagementAfterUrgencyChange(tx, {
      incidentId: id,
      previousUrgency: current.urgency,
      urgency: parsedUrgency,
    });
    await enqueueWarRoomSideEffects(tx, id, [
      { effect: 'WAR_ROOM_MESSAGE', message: `🔔 *Urgency updated to ${parsedUrgency}*` },
    ]);
  });

  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
  revalidatePath('/');
}

export async function updateIncidentPriority(id: string, priority: string | null) {
  await assertResponderOrAbove();

  await prisma.$transaction(async tx => {
    await tx.incident.update({
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
    await enqueueWarRoomSideEffects(tx, id, [
      {
        effect: 'WAR_ROOM_MESSAGE',
        message: `🎯 *Priority updated to ${priority || 'Unassigned'}*`,
      },
    ]);
  });

  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
  revalidatePath('/');
}

export async function updateIncidentDescription(id: string, description: string | null) {
  await assertResponderOrAbove();

  await prisma.$transaction(async tx => {
    await tx.incident.update({
      where: { id },
      data: {
        description: description?.trim() ? description.trim() : null,
        events: {
          create: {
            type: 'COMMENT',
            message: 'Incident description updated',
          },
        },
      },
    });
    await enqueueWarRoomSideEffects(tx, id, [
      {
        effect: 'WAR_ROOM_MESSAGE',
        message: '📄 *Incident description updated*',
      },
    ]);
  });

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

  const rawVisibility = formData.get('visibility');
  const visibility =
    rawVisibility === 'PRIVATE' ? 'PRIVATE' : rawVisibility === 'PUBLIC' ? 'PUBLIC' : undefined;
  const result = await executeIncidentCreation({
    title,
    description,
    urgency,
    serviceId,
    priority: String(formData.get('priority') ?? '') || null,
    dedupKey: String(formData.get('dedupKey') ?? '') || null,
    assigneeId: String(formData.get('assigneeId') ?? '') || null,
    teamId: String(formData.get('teamId') ?? '') || null,
    visibility,
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

  await addIncidentNoteDomainCommand({
    incidentId,
    content,
    actor: { id: user.id, name: user.name },
  });

  revalidatePath(`/incidents/${incidentId}`);
}

export async function reassignIncident(incidentId: string, assigneeId: string, teamId?: string) {
  const actor = await assertResponderOrAbove();

  await assignIncidentDomainCommand({
    incidentId,
    assigneeId,
    teamId,
    actor: { id: actor.id, name: actor.name },
  });

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/incidents');
}

export async function addWatcher(incidentId: string, userId: string, role: string) {
  if (!userId) return;
  const currentUser = await getCurrentUser();
  const canManage = hasCapability(currentUser.role as AppRole, CAPABILITIES.OPERATIONS_MANAGE);
  const watcherRole = role || 'FOLLOWER';

  if (!canManage) {
    await assertCanViewIncident(incidentId);
    if (userId !== currentUser.id || watcherRole !== 'FOLLOWER') {
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'You may only subscribe yourself as a follower.',
        details: { incidentId, requestedUserId: userId, requestedRole: watcherRole },
      });
    }
  }

  await setIncidentWatcher(
    { incidentId, userId, role: watcherRole as 'FOLLOWER' | 'STAKEHOLDER' | 'EXEC' },
    { id: currentUser.id, role: currentUser.role as AppRole }
  );

  revalidatePath(`/incidents/${incidentId}`);
}

export async function removeWatcher(incidentId: string, watcherId: string) {
  const currentUser = await getCurrentUser();
  const canManage = hasCapability(currentUser.role as AppRole, CAPABILITIES.OPERATIONS_MANAGE);
  if (!canManage) await assertCanViewIncident(incidentId);

  await deleteIncidentWatcher(incidentId, watcherId, {
    id: currentUser.id,
    role: currentUser.role as AppRole,
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
      select: {
        id: true,
        name: true,
        defaultIncidentVisibility: true,
        slackChannel: true,
        team: { select: { id: true, name: true } },
        policy: {
          select: {
            id: true,
            name: true,
            steps: {
              take: 1,
              orderBy: { stepOrder: 'asc' },
              include: {
                targetUser: { select: { id: true, name: true, email: true, avatarUrl: true } },
                targetTeam: { select: { id: true, name: true } },
                targetSchedule: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
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
