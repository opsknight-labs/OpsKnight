'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getCurrentUser, assertResponderOrAbove, getUserPermissions } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import {
  getStoredActionItemId,
  normalizeLegacyActionItems,
  parseActionItemDueDate,
  resolveStoredActionItems,
  type ActionItem,
} from '@/lib/action-items';

export type TimelineEvent = {
  id: string;
  timestamp: string;
  type: 'DETECTION' | 'ESCALATION' | 'MITIGATION' | 'RESOLUTION';
  title: string;
  description: string;
  actor?: string;
};

export type ImpactMetrics = {
  usersAffected?: number;
  downtimeMinutes?: number;
  errorRate?: number;
  servicesAffected?: string[];
  slaBreaches?: number;
  revenueImpact?: number;
  apiErrors?: number;
  performanceDegradation?: number;
};

export type PostmortemData = {
  title: string;
  summary?: string;
  timeline?: TimelineEvent[];
  impact?: ImpactMetrics;
  rootCause?: string;
  resolution?: string;
  actionItems?: ActionItem[];
  lessons?: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  isPublic?: boolean;
};

/**
 * Create or update a postmortem for an incident
 */
export async function upsertPostmortem(incidentId: string, data: PostmortemData) {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not found');
  }

  // Check if incident exists and is resolved
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      service: {
        include: {
          team: {
            include: {
              members: { select: { userId: true } },
            },
          },
        },
      },
    },
  });

  if (!incident) {
    throw new Error('Incident not found');
  }

  if (incident.status !== 'RESOLVED') {
    throw new Error('Postmortems can only be created for resolved incidents');
  }

  const existing = await prisma.postmortem.findUnique({
    where: { incidentId },
    select: { createdById: true },
  });

  if (existing && user.role !== 'ADMIN' && existing.createdById !== user.id) {
    const isTeamMember = incident.service?.team?.members.some(m => m.userId === user.id) ?? false;
    const isAssignee = incident.assigneeId === user.id;
    if (!isTeamMember && !isAssignee) {
      throw new Error('Forbidden: You do not have permission to edit this postmortem');
    }
  }

  const postmortem = await prisma.$transaction(async tx => {
    const existingPostmortem = await tx.postmortem.findUnique({
      where: { incidentId },
      select: { publishedAt: true, status: true },
    });

    const publishedAt =
      data.status === 'PUBLISHED'
        ? (existingPostmortem?.publishedAt ?? new Date())
        : data.status === 'DRAFT'
          ? null
          : existingPostmortem?.publishedAt;

    const upserted = await tx.postmortem.upsert({
      where: { incidentId },
      update: {
        ...data,
        publishedAt,
        updatedAt: new Date(),
      },
      create: {
        incidentId,
        createdById: user.id,
        ...data,
        publishedAt: data.status === 'PUBLISHED' ? new Date() : null,
      },
    });

    if (Array.isArray(data.actionItems)) {
      const existingItems = await tx.actionItem.findMany({
        where: { postmortemId: upserted.id },
        select: { id: true, completedAt: true },
      });
      const existingById = new Map(existingItems.map(item => [item.id, item]));
      const normalizedItems = data.actionItems.map((item, index) => {
        const itemId = getStoredActionItemId({
          postmortemId: upserted.id,
          legacyId: item.id,
          index,
        });
        const existing = existingById.get(itemId);

        return {
          id: itemId,
          title: item.title.trim() || 'Untitled action item',
          description: item.description.trim() || null,
          ownerId: item.owner || null,
          dueDate: parseActionItemDueDate(item.dueDate) ?? null,
          status: item.status,
          priority: item.priority,
          source: 'POSTMORTEM' as const,
          completedAt: item.status === 'COMPLETED' ? (existing?.completedAt ?? new Date()) : null,
        };
      });

      if (normalizedItems.length === 0) {
        await tx.actionItem.deleteMany({
          where: { postmortemId: upserted.id },
        });
      } else {
        await tx.actionItem.deleteMany({
          where: {
            postmortemId: upserted.id,
            id: { notIn: normalizedItems.map(item => item.id) },
          },
        });

        for (const item of normalizedItems) {
          await tx.actionItem.upsert({
            where: { id: item.id },
            update: {
              title: item.title,
              description: item.description,
              ownerId: item.ownerId,
              dueDate: item.dueDate,
              status: item.status,
              priority: item.priority,
              source: item.source,
              completedAt: item.completedAt,
            },
            create: {
              id: item.id,
              postmortemId: upserted.id,
              incidentId,
              title: item.title,
              description: item.description,
              ownerId: item.ownerId,
              dueDate: item.dueDate,
              status: item.status,
              priority: item.priority,
              source: item.source,
              completedAt: item.completedAt,
            },
          });
        }
      }
    }

    return upserted;
  });

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/postmortems');
  return { success: true, postmortem };
}

/**
 * Get postmortem for an incident
 */
export async function getPostmortem(incidentId: string) {
  const user = await getCurrentUser();
  const canViewDrafts = hasCapability(user.role, CAPABILITIES.POSTMORTEM_DRAFT_READ);
  const postmortem = await prisma.postmortem.findUnique({
    where: {
      incidentId,
      ...(canViewDrafts ? {} : { status: 'PUBLISHED' }),
    },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      incident: {
        select: {
          id: true,
          title: true,
          status: true,
          resolvedAt: true,
        },
      },
      actionItemRecords: {
        include: {
          externalIssueLinks: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              provider: true,
              externalKey: true,
              externalUrl: true,
              externalStatus: true,
              externalAssignee: true,
              syncState: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!postmortem) {
    return null;
  }

  let { actionItemRecords } = postmortem;
  const { actionItems, ...rest } = postmortem;

  // Rolling migration aid: old postmortems may still only have JSON action
  // items. Hydrate normalized rows on first read so Jira linking works without
  // requiring a maintenance window.
  if (canViewDrafts && actionItemRecords.length === 0) {
    const legacyItems = normalizeLegacyActionItems(actionItems, {
      legacyIdPrefix: `postmortem-${postmortem.id}`,
    });

    if (legacyItems.length > 0) {
      await prisma.$transaction(async tx => {
        for (const [index, item] of legacyItems.entries()) {
          await tx.actionItem.upsert({
            where: {
              id: getStoredActionItemId({
                postmortemId: postmortem.id,
                legacyId: item.id,
                index,
              }),
            },
            update: {},
            create: {
              id: getStoredActionItemId({
                postmortemId: postmortem.id,
                legacyId: item.id,
                index,
              }),
              postmortemId: postmortem.id,
              incidentId: postmortem.incident.id,
              title: item.title.trim() || 'Untitled action item',
              description: item.description.trim() || null,
              ownerId: item.owner || null,
              dueDate: parseActionItemDueDate(item.dueDate) ?? null,
              status: item.status,
              priority: item.priority,
              source: 'POSTMORTEM',
              completedAt: item.status === 'COMPLETED' ? new Date() : null,
            },
          });
        }
      });

      actionItemRecords = await prisma.actionItem.findMany({
        where: { postmortemId: postmortem.id },
        include: {
          externalIssueLinks: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              provider: true,
              externalKey: true,
              externalUrl: true,
              externalStatus: true,
              externalAssignee: true,
              syncState: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    }
  }

  return {
    ...rest,
    actionItems: resolveStoredActionItems({
      records: actionItemRecords,
      legacy: actionItems,
      legacyIdPrefix: `postmortem-${postmortem.id}`,
    }),
  };
}

/**
 * Get all postmortems with pagination
 */
export async function getAllPostmortems(
  options: {
    status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    page?: number;
    limit?: number;
  } = {}
) {
  const { status, page = 1, limit = 50 } = options;
  const skip = (page - 1) * limit;

  const permissions = await getUserPermissions();
  const where = permissions.isResponderOrAbove
    ? status
      ? { status }
      : {}
    : { status: 'PUBLISHED' as const };

  const [postmortems, total] = await Promise.all([
    prisma.postmortem.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        incident: {
          select: {
            id: true,
            title: true,
            status: true,
            service: {
              select: { id: true, name: true },
            },
            resolvedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.postmortem.count({ where }),
  ]);

  return {
    postmortems,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      itemsPerPage: limit,
    },
  };
}

/**
 * Delete a postmortem
 */
export async function deletePostmortem(incidentId: string) {
  let user;
  try {
    user = await assertResponderOrAbove();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const pm = await prisma.postmortem.findUnique({
    where: { incidentId },
    select: { id: true, createdById: true },
  });

  if (!pm) {
    throw new Error('Postmortem not found');
  }

  if (user.role !== 'ADMIN' && pm.createdById !== user.id) {
    throw new Error(
      'Forbidden: Only administrators or the postmortem author can delete this record'
    );
  }

  await prisma.postmortem.delete({
    where: { incidentId },
  });

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/postmortems');
  return { success: true };
}

/**
 * Generate a draft postmortem using heuristics (Template Engine)
 */
export async function generatePostmortemDraft(incidentId: string, userTimeZone?: string) {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      service: true,
      events: {
        orderBy: { createdAt: 'asc' },
      },
      notes: {
        include: {
          user: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!incident) {
    throw new Error('Incident not found');
  }

  // 1. Calculate Duration & Impact
  const start = new Date(incident.createdAt);
  const tz = userTimeZone || 'UTC';
  const end = incident.resolvedAt ? new Date(incident.resolvedAt) : new Date();
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const durationMinutes = Math.max(0, Math.floor(durationMs / 60000));
  const durationHours = Math.floor(durationMinutes / 60);
  const durationString =
    durationHours > 0 ? `${durationHours}h ${durationMinutes % 60}m` : `${durationMinutes}m`;

  const impact: ImpactMetrics = {
    downtimeMinutes: durationMinutes,
    servicesAffected: [incident.service.name],
  };

  // 2. Generate Summary
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  }).format(start);
  const startTime = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: tz,
  }).format(start);
  const endTime = incident.resolvedAt
    ? new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        timeZone: tz,
      }).format(end)
    : 'ongoing';

  const summary = `On ${date}, the ${incident.service.name} service experienced an incident${incident.urgency === 'HIGH' ? ' (High Urgency)' : ''}. The incident began at ${startTime} and was resolved at ${endTime}. The total duration of impact was ${durationString}.`;

  // 3. Generate Timeline from Incident Events & Notes
  const eventEntries: TimelineEvent[] = incident.events.map(event => {
    let type: TimelineEvent['type'] = 'DETECTION';
    const msg = event.message.toLowerCase();
    if (msg.includes('resolved') || msg.includes('fixed')) type = 'RESOLUTION';
    else if (msg.includes('escalated') || msg.includes('notified') || msg.includes('acknowledg'))
      type = 'ESCALATION';
    else if (msg.includes('mitigated') || msg.includes('stabilized')) type = 'MITIGATION';

    return {
      id: `draft-evt-${event.id}`,
      timestamp: event.createdAt.toISOString(),
      type,
      title: event.message.length > 50 ? event.message.substring(0, 50) + '...' : event.message,
      description: event.message,
      actor: 'System',
    };
  });

  const noteEntries: TimelineEvent[] = (incident.notes || []).map(note => ({
    id: `draft-note-${note.id}`,
    timestamp: note.createdAt.toISOString(),
    type: 'MITIGATION',
    title: `Note by ${note.user?.name || 'Responder'}`,
    description: note.content,
    actor: note.user?.name || 'Responder',
  }));

  const timeline: TimelineEvent[] = [...eventEntries, ...noteEntries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Add explicit start/end events if missing
  if (!timeline.some(e => e.type === 'DETECTION')) {
    timeline.unshift({
      id: `draft-start`,
      timestamp: incident.createdAt.toISOString(),
      type: 'DETECTION',
      title: 'Incident Started',
      description: `Incident created for ${incident.service.name}`,
    });
  }
  if (incident.resolvedAt && !timeline.some(e => e.type === 'RESOLUTION')) {
    timeline.push({
      id: `draft-end`,
      timestamp: incident.resolvedAt.toISOString(),
      type: 'RESOLUTION',
      title: 'Incident Resolved',
      description: 'Incident marked as resolved.',
    });
  }
  timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return {
    summary,
    impact,
    timeline,
    rootCause: 'To be determined. Preliminary analysis suggests...',
    resolution: 'Service was restored by...',
    lessons: '1. Improve monitoring for...\n2. Update runbooks for...',
  };
}

/**
 * Bulk delete postmortems by IDs
 */
export async function bulkDeletePostmortems(ids: string[]) {
  let currentUser: Awaited<ReturnType<typeof assertResponderOrAbove>>;
  try {
    currentUser = await assertResponderOrAbove();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  if (!ids || ids.length === 0) {
    return { success: false, error: 'No postmortems selected' };
  }

  const selected = await prisma.postmortem.findMany({
    where: {
      OR: [{ id: { in: ids } }, { incidentId: { in: ids } }],
    },
    select: { id: true, createdById: true },
  });

  if (selected.length === 0) {
    return { success: false, error: 'No matching postmortems found' };
  }

  if (
    currentUser.role !== 'ADMIN' &&
    selected.some(postmortem => postmortem.createdById !== currentUser.id)
  ) {
    return {
      success: false,
      error: 'Only administrators or the postmortem author can delete the selected records',
    };
  }

  const deleted = await prisma.postmortem.deleteMany({
    where: { id: { in: selected.map(postmortem => postmortem.id) } },
  });

  revalidatePath('/postmortems');
  return { success: true, count: deleted.count };
}
