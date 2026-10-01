'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertCanViewIncident } from '@/lib/rbac';
import {
  addNote,
  addWatcher,
  removeWatcher,
  updateIncidentDescription,
  updateIncidentStatus,
} from '@/app/(app)/incidents/actions';

const incidentIdSchema = z.string().trim().min(1).max(191);
const noteSchema = z.string().trim().min(1).max(10_000);
const watcherIdSchema = z.string().trim().min(1).max(191);
const watcherRoleSchema = z.string().trim().min(1).max(64);
const descriptionSchema = z.string().max(50_000);

function incidentId(value: string) {
  return incidentIdSchema.parse(value);
}

export async function addIncidentDetailNote(incidentIdValue: string, formData: FormData) {
  const parsedIncidentId = incidentId(incidentIdValue);
  const content = noteSchema.parse(formData.get('content'));
  await addNote(parsedIncidentId, content);
}

export async function acknowledgeIncidentDetail(incidentIdValue: string) {
  await updateIncidentStatus(incidentId(incidentIdValue), 'ACKNOWLEDGED');
}

export async function reopenIncidentDetail(incidentIdValue: string) {
  await updateIncidentStatus(incidentId(incidentIdValue), 'OPEN');
}

export async function suppressIncidentDetail(incidentIdValue: string) {
  await updateIncidentStatus(incidentId(incidentIdValue), 'SUPPRESSED');
}

export async function addIncidentDetailWatcher(incidentIdValue: string, formData: FormData) {
  const parsedIncidentId = incidentId(incidentIdValue);
  const watcherId = watcherIdSchema.parse(formData.get('watcherId'));
  const role = watcherRoleSchema.parse(formData.get('watcherRole'));
  await addWatcher(parsedIncidentId, watcherId, role);
}

export async function removeIncidentDetailWatcher(incidentIdValue: string, formData: FormData) {
  const parsedIncidentId = incidentId(incidentIdValue);
  const watcherId = watcherIdSchema.parse(formData.get('watcherMemberId'));
  await removeWatcher(parsedIncidentId, watcherId);
}

export async function updateIncidentDetailDescription(
  incidentIdValue: string,
  description: string
) {
  await updateIncidentDescription(
    incidentId(incidentIdValue),
    descriptionSchema.parse(description)
  );
}

import { redactNotificationError } from '@/lib/notification-operations';

export async function loadOlderIncidentEvents(
  incidentIdValue: string,
  beforeDateISO: string,
  beforeId?: string,
  limit = 200
) {
  const parsedIncidentId = incidentId(incidentIdValue);
  await assertCanViewIncident(parsedIncidentId);
  const cursorDate = new Date(beforeDateISO);
  const events = await prisma.incidentEvent.findMany({
    where: {
      incidentId: parsedIncidentId,
      ...(beforeId
        ? {
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: cursorDate, id: { lt: beforeId } },
            ],
          }
        : { createdAt: { lt: cursorDate } }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(1, limit), 500),
  });
  return events.map(e => ({
    id: e.id,
    message: e.message,
    type: e.type,
    createdAt: e.createdAt,
  }));
}

export async function loadOlderIncidentNotes(
  incidentIdValue: string,
  beforeDateISO: string,
  beforeId?: string,
  limit = 100
) {
  const parsedIncidentId = incidentId(incidentIdValue);
  await assertCanViewIncident(parsedIncidentId);
  const cursorDate = new Date(beforeDateISO);
  const notes = await prisma.incidentNote.findMany({
    where: {
      incidentId: parsedIncidentId,
      ...(beforeId
        ? {
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: cursorDate, id: { lt: beforeId } },
            ],
          }
        : { createdAt: { lt: cursorDate } }),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          gender: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(1, limit), 200),
  });
  return notes.map(n => ({
    id: n.id,
    content: n.content,
    createdAt: n.createdAt,
    user: n.user,
  }));
}

export type TableCursor = {
  createdAt: string;
  id: string;
};

export type TimelineActivityCursors = {
  eventCursor?: TableCursor;
  noteCursor?: TableCursor;
  notificationCursor?: TableCursor;
};

function buildTableCursorFilter(cursor?: TableCursor) {
  if (!cursor) return {};
  const cursorDate = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: cursorDate } },
      { createdAt: cursorDate, id: { lt: cursor.id } },
    ],
  };
}

export async function loadOlderIncidentTimelineActivity(
  incidentIdValue: string,
  cursorsOrBeforeDateISO: TimelineActivityCursors | string,
  beforeIdOrLimit?: string | number,
  limitParam = 100
) {
  const parsedIncidentId = incidentId(incidentIdValue);
  await assertCanViewIncident(parsedIncidentId);

  let eventFilter = {};
  let noteFilter = {};
  let notifFilter = {};
  let limit = limitParam;

  if (typeof cursorsOrBeforeDateISO === 'object' && cursorsOrBeforeDateISO !== null) {
    eventFilter = buildTableCursorFilter(cursorsOrBeforeDateISO.eventCursor);
    noteFilter = buildTableCursorFilter(cursorsOrBeforeDateISO.noteCursor);
    notifFilter = buildTableCursorFilter(cursorsOrBeforeDateISO.notificationCursor);
    if (typeof beforeIdOrLimit === 'number') {
      limit = beforeIdOrLimit;
    }
  } else {
    const cursorDate = new Date(cursorsOrBeforeDateISO);
    const cursorFilter =
      typeof beforeIdOrLimit === 'string' && beforeIdOrLimit
        ? {
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: cursorDate, id: { lt: beforeIdOrLimit } },
            ],
          }
        : { createdAt: { lt: cursorDate } };
    eventFilter = cursorFilter;
    noteFilter = cursorFilter;
    notifFilter = cursorFilter;
  }

  const [events, notes, notifications] = await Promise.all([
    prisma.incidentEvent.findMany({
      where: {
        incidentId: parsedIncidentId,
        ...eventFilter,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(1, limit), 200),
    }),
    prisma.incidentNote.findMany({
      where: {
        incidentId: parsedIncidentId,
        ...noteFilter,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            gender: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(1, limit), 200),
    }),
    prisma.notification.findMany({
      where: {
        incidentId: parsedIncidentId,
        ...notifFilter,
      },
      select: {
        id: true,
        channel: true,
        status: true,
        recipientDisplay: true,
        errorMsg: true,
        createdAt: true,
        sentAt: true,
        deliveredAt: true,
        failedAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(1, limit), 200),
    }),
  ]);

  return {
    events: events.map(e => ({
      id: e.id,
      message: e.message,
      type: e.type,
      createdAt: e.createdAt,
    })),
    notes: notes.map(n => ({
      id: n.id,
      content: n.content,
      createdAt: n.createdAt,
      user: n.user,
    })),
    notifications: notifications.map(notif => ({
      id: notif.id,
      channel: notif.channel,
      status: notif.status,
      recipientDisplay: notif.recipientDisplay,
      errorMsg: redactNotificationError(notif.errorMsg),
      createdAt: notif.createdAt,
      sentAt: notif.sentAt,
      deliveredAt: notif.deliveredAt,
      failedAt: notif.failedAt,
      user: notif.user,
    })),
  };
}
