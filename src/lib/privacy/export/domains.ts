import 'server-only';

import prisma from '@/lib/prisma';

/**
 * Each fetcher selects an explicit, hand-picked column allowlist. Never widen
 * these with `include`/spread — a new sensitive column added to a model must
 * be deliberately opted into an export, not inherited automatically.
 */

export async function fetchProfile(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      timeZone: true,
      phoneNumber: true,
      department: true,
      jobTitle: true,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: true,
      pushNotificationsEnabled: true,
      whatsappNotificationsEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function fetchIdentities(userId: string) {
  return prisma.oidcIdentity.findMany({
    where: { userId },
    select: {
      id: true,
      issuer: true,
      email: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
}

export async function fetchMemberships(userId: string) {
  return prisma.teamMember.findMany({
    where: { userId },
    select: {
      id: true,
      role: true,
      team: { select: { id: true, name: true } },
    },
  });
}

export async function fetchIncidents(userId: string) {
  return prisma.incident.findMany({
    where: { assigneeId: userId },
    select: {
      id: true,
      title: true,
      status: true,
      urgency: true,
      priority: true,
      createdAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      service: { select: { id: true, name: true } },
    },
  });
}

export async function fetchIncidentNotes(userId: string) {
  return prisma.incidentNote.findMany({
    where: { userId },
    select: {
      id: true,
      incidentId: true,
      content: true,
      createdAt: true,
    },
  });
}

export async function fetchSchedules(userId: string) {
  const [shifts, overrides] = await Promise.all([
    prisma.onCallShift.findMany({
      where: { userId },
      select: {
        id: true,
        start: true,
        end: true,
        schedule: { select: { id: true, name: true } },
      },
    }),
    prisma.onCallOverride.findMany({
      where: { userId },
      select: {
        id: true,
        start: true,
        end: true,
        schedule: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { shifts, overrides };
}

export async function fetchNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    select: {
      id: true,
      incidentId: true,
      channel: true,
      status: true,
      category: true,
      scheduledAt: true,
      sentAt: true,
      deliveredAt: true,
      failedAt: true,
    },
    take: 5000,
  });
}

/** Only action/entity metadata — never the `details` blob, which may reference other subjects. */
export async function fetchAuditEvents(userId: string) {
  return prisma.auditLog.findMany({
    where: { OR: [{ actorId: userId }, { entityType: 'USER', entityId: userId }] },
    select: {
      id: true,
      action: true,
      entityType: true,
      createdAt: true,
    },
    take: 5000,
  });
}
