import 'server-only';

import type {
  fetchAuditEvents,
  fetchIdentities,
  fetchIncidentNotes,
  fetchIncidents,
  fetchMemberships,
  fetchNotifications,
  fetchProfile,
  fetchSchedules,
} from './domains';

type Awaited2<T> = T extends (...args: never[]) => Promise<infer R> ? R : never;

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export function serializeProfile(profile: Awaited2<typeof fetchProfile>) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    status: profile.status,
    timeZone: profile.timeZone,
    phoneNumber: profile.phoneNumber,
    department: profile.department,
    jobTitle: profile.jobTitle,
    notificationPreferences: {
      email: profile.emailNotificationsEnabled,
      sms: profile.smsNotificationsEnabled,
      push: profile.pushNotificationsEnabled,
      whatsapp: profile.whatsappNotificationsEnabled,
    },
    createdAt: iso(profile.createdAt),
    updatedAt: iso(profile.updatedAt),
  };
}

export function serializeIdentities(identities: Awaited2<typeof fetchIdentities>) {
  return identities.map(identity => ({
    id: identity.id,
    issuer: identity.issuer,
    email: identity.email,
    lastLoginAt: iso(identity.lastLoginAt),
    createdAt: iso(identity.createdAt),
  }));
}

export function serializeMemberships(memberships: Awaited2<typeof fetchMemberships>) {
  return memberships.map(membership => ({
    id: membership.id,
    role: membership.role,
    teamId: membership.team.id,
    teamName: membership.team.name,
  }));
}

export function serializeIncidents(incidents: Awaited2<typeof fetchIncidents>) {
  return incidents.map(incident => ({
    id: incident.id,
    title: incident.title,
    status: incident.status,
    urgency: incident.urgency,
    priority: incident.priority,
    serviceId: incident.service.id,
    serviceName: incident.service.name,
    createdAt: iso(incident.createdAt),
    acknowledgedAt: iso(incident.acknowledgedAt),
    resolvedAt: iso(incident.resolvedAt),
  }));
}

export function serializeIncidentNotes(notes: Awaited2<typeof fetchIncidentNotes>) {
  return notes.map(note => ({
    id: note.id,
    incidentId: note.incidentId,
    content: note.content,
    createdAt: iso(note.createdAt),
  }));
}

export function serializeSchedules(schedules: Awaited2<typeof fetchSchedules>) {
  return {
    shifts: schedules.shifts.map(shift => ({
      id: shift.id,
      scheduleId: shift.schedule.id,
      scheduleName: shift.schedule.name,
      start: iso(shift.start),
      end: iso(shift.end),
    })),
    overrides: schedules.overrides.map(override => ({
      id: override.id,
      scheduleId: override.schedule.id,
      scheduleName: override.schedule.name,
      start: iso(override.start),
      end: iso(override.end),
    })),
  };
}

export function serializeNotifications(notifications: Awaited2<typeof fetchNotifications>) {
  return notifications.map(notification => ({
    id: notification.id,
    incidentId: notification.incidentId,
    channel: notification.channel,
    status: notification.status,
    category: notification.category,
    scheduledAt: iso(notification.scheduledAt),
    sentAt: iso(notification.sentAt),
    deliveredAt: iso(notification.deliveredAt),
    failedAt: iso(notification.failedAt),
  }));
}

export function serializeAuditEvents(events: Awaited2<typeof fetchAuditEvents>) {
  return events.map(event => ({
    id: event.id,
    action: event.action,
    entityType: event.entityType,
    createdAt: iso(event.createdAt),
  }));
}
