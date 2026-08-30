import prisma from './prisma';
import { sendPush, type PushResult } from './push';
import { decodeNotificationEnvelope } from './notification-payload';
import { getUserTimeZone } from './timezone';
import { formatPushTimestamp } from './mobile-time';
import type { NotificationEventType } from './notification-delivery';

/** Render a push from the immutable Notification payload instead of current incident state. */
export async function sendNotificationIntentPush(
  userId: string,
  incidentId: string,
  eventType: NotificationEventType,
  durableMessage: string | null | undefined,
  notificationId: string
): Promise<PushResult> {
  const envelope = decodeNotificationEnvelope(durableMessage);
  if (!envelope) {
    const { sendIncidentPush } = await import('./push');
    return sendIncidentPush(userId, incidentId, eventType);
  }

  const { snapshot, displayMessage } = envelope;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  const timeLabel = formatPushTimestamp(new Date(snapshot.eventAt), getUserTimeZone(user ?? undefined));
  const owner = snapshot.assignee?.name || snapshot.assignee?.email || snapshot.team?.name || 'Unassigned';
  const escalation = snapshot.escalationLevel;
  const eventLabel = escalation ? `Escalation Level ${escalation}` : eventType === 'triggered' ? 'Triggered' : eventType === 'acknowledged' ? 'Acknowledged' : eventType === 'resolved' ? 'Resolved' : 'Updated';
  const emoji = escalation ? '🚨' : eventType === 'resolved' ? '✅' : eventType === 'acknowledged' ? '👀' : eventType === 'updated' ? 'ℹ️' : snapshot.urgency === 'HIGH' ? '🔴' : snapshot.urgency === 'MEDIUM' ? '🟡' : '🔵';
  const title = `${emoji} ${eventLabel} • ${snapshot.service.name}`;
  let body = `${snapshot.title}\n${eventLabel} • ${owner} • ${timeLabel}`;
  if ((eventType === 'triggered' || escalation) && snapshot.urgency === 'HIGH') body += '\n🚨 Urgent Action Required';
  if (displayMessage && !displayMessage.includes(snapshot.title)) body += `\n${displayMessage.slice(0, 120)}`;
  else if (snapshot.description) body += `\n${snapshot.description.length > 80 ? `${snapshot.description.slice(0, 77)}...` : snapshot.description}`;

  return sendPush({
    userId,
    title,
    body,
    data: {
      incidentId,
      incidentUrl: `/incidents/${incidentId}`,
      eventType,
      urgency: snapshot.urgency,
      status: snapshot.status,
      tag: `incident-${incidentId}-${notificationId.slice(-16)}`,
      url: `/m/incidents/${incidentId}`,
      actions: JSON.stringify(eventType === 'triggered' ? [
        { action: 'view', title: '👁️ View', icon: '/icons/app-icon-192.png' },
        { action: 'acknowledge', title: '✓ Acknowledge', icon: '/icons/app-icon-192.png' },
      ] : [{ action: 'view', title: '👁️ View', icon: '/icons/app-icon-192.png' }]),
    },
    badge: 1,
  });
}
