import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';

export type StatusDeliveryTarget = 'SUBSCRIBER_EMAIL' | 'STATUS_WEBHOOK';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function statusDeliveryMarkerId(
  target: StatusDeliveryTarget,
  deliveryKey: string,
  targetId: string
): string {
  return `status-delivery:${hash(`${target}\u001f${deliveryKey}\u001f${targetId}`)}`;
}

export async function isStatusDeliveryComplete(markerId: string): Promise<boolean> {
  const marker = await prisma.backgroundJob.findUnique({
    where: { id: markerId },
    select: { status: true },
  });
  return marker?.status === 'COMPLETED';
}

export async function markStatusDeliveryComplete(input: {
  markerId: string;
  target: StatusDeliveryTarget;
  deliveryKey: string;
  targetId: string;
}): Promise<void> {
  const now = new Date();
  await prisma.backgroundJob.upsert({
    where: { id: input.markerId },
    update: {
      status: 'COMPLETED',
      completedAt: now,
      failedAt: null,
      error: null,
      payload: {
        task: 'STATUS_DELIVERY_MARKER',
        target: input.target,
        deliveryKey: input.deliveryKey,
        targetId: input.targetId,
      },
    },
    create: {
      id: input.markerId,
      type: 'SCHEDULED_TASK',
      status: 'COMPLETED',
      scheduledAt: now,
      completedAt: now,
      maxAttempts: 1,
      payload: {
        task: 'STATUS_DELIVERY_MARKER',
        target: input.target,
        deliveryKey: input.deliveryKey,
        targetId: input.targetId,
      },
    },
  });
}

export function incidentSubscriberDeliveryKey(
  incident: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    acknowledgedAt?: Date | null;
    resolvedAt?: Date | null;
  },
  eventType: string,
  explicitKey?: string
): string {
  if (explicitKey) return explicitKey;

  const lifecycleInstant =
    eventType === 'triggered'
      ? incident.createdAt
      : eventType === 'acknowledged'
        ? incident.acknowledgedAt
        : eventType === 'resolved'
          ? incident.resolvedAt
          : incident.updatedAt;

  return `${incident.id}:${eventType}:${(lifecycleInstant ?? incident.updatedAt).toISOString()}`;
}

export function statusWebhookDeliveryKey(
  event: string,
  data: Record<string, unknown>,
  explicitKey?: string
): string {
  if (explicitKey) return explicitKey;

  const id = typeof data.id === 'string' ? data.id : 'unknown';
  const lifecycleInstant =
    event === 'incident.created'
      ? data.createdAt
      : event === 'incident.acknowledged'
        ? data.acknowledgedAt
        : event === 'incident.resolved'
          ? data.resolvedAt
          : undefined;

  if (typeof lifecycleInstant === 'string' && lifecycleInstant) {
    return `${id}:${event}:${lifecycleInstant}`;
  }

  return `${id}:${event}:${hash(JSON.stringify(data))}`;
}

export function statusWebhookDeliveryId(deliveryKey: string, webhookId: string): string {
  return hash(`status-webhook\u001f${deliveryKey}\u001f${webhookId}`);
}

export function buildSubscriberIncidentPresentation<
  T extends {
    title: string;
    description?: string | null;
    service?: { name?: string | null } | null;
  },
>(
  page: {
    showIncidentDetails: boolean;
    showIncidentTitles: boolean;
    showIncidentDescriptions: boolean;
    showAffectedServices: boolean;
    showIncidentTimestamps: boolean;
  },
  incident: T
): {
  incident: T;
  showAffectedService: boolean;
  showDescription: boolean;
  showTimestamp: boolean;
} {
  const showDetails = page.showIncidentDetails;
  const showTitle = showDetails && page.showIncidentTitles;
  const showDescription = showDetails && page.showIncidentDescriptions;
  const showAffectedService = showDetails && page.showAffectedServices;

  return {
    incident: {
      ...incident,
      title: showTitle ? incident.title : 'Incident Update',
      description: showDescription ? incident.description : null,
      service: incident.service
        ? {
            ...incident.service,
            name: showAffectedService ? incident.service.name : 'Service',
          }
        : incident.service,
    },
    showAffectedService,
    showDescription,
    showTimestamp: showDetails && page.showIncidentTimestamps,
  };
}