import { describe, expect, it } from 'vitest';
import {
  buildSubscriberIncidentPresentation,
  incidentSubscriberDeliveryKey,
  statusWebhookDeliveryId,
  statusWebhookDeliveryKey,
} from '@/lib/status-page-delivery';

const incident = {
  id: 'incident-1',
  title: 'Database credentials exposed',
  description: 'Sensitive diagnostic details',
  service: { name: 'Payments Primary' },
  createdAt: new Date('2026-08-30T10:00:00.000Z'),
  updatedAt: new Date('2026-08-30T10:15:00.000Z'),
  acknowledgedAt: new Date('2026-08-30T10:05:00.000Z'),
  resolvedAt: new Date('2026-08-30T10:20:00.000Z'),
};

describe('status page delivery semantics', () => {
  it('redacts subscriber incident fields according to the public page privacy contract', () => {
    const presentation = buildSubscriberIncidentPresentation(
      {
        showIncidentDetails: true,
        showIncidentTitles: false,
        showIncidentDescriptions: false,
        showAffectedServices: false,
        showIncidentTimestamps: false,
      },
      incident
    );

    expect(presentation.incident.title).toBe('Incident Update');
    expect(presentation.incident.description).toBeNull();
    expect(presentation.incident.service?.name).toBe('Service');
    expect(presentation).toMatchObject({
      showAffectedService: false,
      showDescription: false,
      showTimestamp: false,
    });
  });

  it('treats showIncidentDetails=false as the master privacy gate', () => {
    const presentation = buildSubscriberIncidentPresentation(
      {
        showIncidentDetails: false,
        showIncidentTitles: true,
        showIncidentDescriptions: true,
        showAffectedServices: true,
        showIncidentTimestamps: true,
      },
      incident
    );

    expect(presentation.incident).toMatchObject({
      title: 'Incident Update',
      description: null,
      service: { name: 'Service' },
    });
    expect(presentation.showTimestamp).toBe(false);
  });

  it('preserves published incident fields when every privacy switch permits them', () => {
    const presentation = buildSubscriberIncidentPresentation(
      {
        showIncidentDetails: true,
        showIncidentTitles: true,
        showIncidentDescriptions: true,
        showAffectedServices: true,
        showIncidentTimestamps: true,
      },
      incident
    );

    expect(presentation.incident).toMatchObject({
      title: incident.title,
      description: incident.description,
      service: { name: incident.service.name },
    });
    expect(presentation.showTimestamp).toBe(true);
  });

  it('uses lifecycle timestamps as stable semantic delivery keys', () => {
    expect(incidentSubscriberDeliveryKey(incident, 'acknowledged')).toBe(
      'incident-1:acknowledged:2026-08-30T10:05:00.000Z'
    );

    const first = statusWebhookDeliveryKey('incident.resolved', {
      id: incident.id,
      title: 'old title',
      resolvedAt: incident.resolvedAt.toISOString(),
    });
    const retry = statusWebhookDeliveryKey('incident.resolved', {
      id: incident.id,
      title: 'newly fetched title',
      resolvedAt: incident.resolvedAt.toISOString(),
    });
    expect(retry).toBe(first);
  });

  it('derives stable target-specific webhook delivery ids', () => {
    const key = 'incident-1:incident.resolved:2026-08-30T10:20:00.000Z';
    const first = statusWebhookDeliveryId(key, 'webhook-a');
    expect(statusWebhookDeliveryId(key, 'webhook-a')).toBe(first);
    expect(statusWebhookDeliveryId(key, 'webhook-b')).not.toBe(first);
  });
});