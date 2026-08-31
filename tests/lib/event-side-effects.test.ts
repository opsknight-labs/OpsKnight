import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeEscalation as mockedExecuteEscalation } from '@/lib/notifications';
import { sendServiceNotifications as mockedSendServiceNotifications } from '@/lib/service-notifications';
import { sendIncidentNotifications as mockedSendIncidentNotifications } from '@/lib/user-notifications';
import { triggerWebhooksForService as mockedTriggerWebhooksForService } from '@/lib/status-page-webhooks';
import {
  archiveWarRoomChannel as mockedArchiveWarRoomChannel,
  createIncidentWarRoom as mockedCreateIncidentWarRoom,
  postWarRoomUpdate as mockedPostWarRoomUpdate,
  updateWarRoomTopic as mockedUpdateWarRoomTopic,
} from '@/lib/chatops/war-room';
import prisma from '@/lib/prisma';
import { processEventSideEffect } from '@/lib/event-side-effects';
import type { EventSideEffectPayload } from '@/lib/event-outbox';

type TestMock = ReturnType<typeof vi.fn>;

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/notifications', () => ({ executeEscalation: vi.fn() }));
vi.mock('@/lib/service-notifications', () => ({ sendServiceNotifications: vi.fn() }));
vi.mock('@/lib/user-notifications', () => ({ sendIncidentNotifications: vi.fn() }));
vi.mock('@/lib/status-page-webhooks', () => ({ triggerWebhooksForService: vi.fn() }));
vi.mock('@/lib/status-page-notifications', () => ({ notifyStatusPageSubscribers: vi.fn() }));
vi.mock('@/lib/slack', () => ({ notifySlackForIncident: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { incident: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/chatops/war-room', () => ({
  createIncidentWarRoom: vi.fn(),
  archiveWarRoomChannel: vi.fn(),
  postWarRoomUpdate: vi.fn(),
  updateWarRoomTopic: vi.fn(),
}));

const executeEscalationMock = mockedExecuteEscalation as unknown as TestMock;
const sendServiceNotificationsMock = mockedSendServiceNotifications as unknown as TestMock;
const sendIncidentNotificationsMock = mockedSendIncidentNotifications as unknown as TestMock;
const triggerWebhooksForServiceMock = mockedTriggerWebhooksForService as unknown as TestMock;
const archiveWarRoomChannelMock = mockedArchiveWarRoomChannel as unknown as TestMock;
const createIncidentWarRoomMock = mockedCreateIncidentWarRoom as unknown as TestMock;
const postWarRoomUpdateMock = mockedPostWarRoomUpdate as unknown as TestMock;
const updateWarRoomTopicMock = mockedUpdateWarRoomTopic as unknown as TestMock;
const prismaMock = prisma as unknown as { incident: { findUnique: TestMock } };

function payload(
  effect: EventSideEffectPayload['effect'],
  lane: EventSideEffectPayload['lane'] = 'ESCALATION',
  lifecycle?: EventSideEffectPayload['lifecycle']
): EventSideEffectPayload {
  return {
    task: 'EVENT_SIDE_EFFECT',
    effect,
    lane,
    incidentId: 'inc-1',
    eventOrderAt: '2026-08-28T07:00:00.000Z',
    ...(lifecycle ? { lifecycle } : {}),
  };
}

describe('event durable side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps escalation failure isolated so the durable job retries without duplicating service delivery', async () => {
    executeEscalationMock.mockRejectedValue(new Error('escalation unavailable'));

    await expect(
      processEventSideEffect(payload('TRIGGER_ESCALATION_NOTIFICATIONS'))
    ).rejects.toThrow('escalation unavailable');

    expect(sendServiceNotificationsMock).not.toHaveBeenCalled();
    expect(sendIncidentNotificationsMock).not.toHaveBeenCalled();
  });

  it('lets notification-provider failure escape so the durable job retries', async () => {
    executeEscalationMock.mockResolvedValue({
      escalated: false,
      reason: 'No escalation policy configured',
    });
    sendIncidentNotificationsMock.mockRejectedValue(new Error('provider unavailable'));
    await expect(
      processEventSideEffect(payload('TRIGGER_ESCALATION_NOTIFICATIONS'))
    ).rejects.toThrow('provider unavailable');
    expect(sendIncidentNotificationsMock).toHaveBeenCalledTimes(1);
    expect(sendServiceNotificationsMock).not.toHaveBeenCalled();
  });

  it('retries an explicit notification failure result', async () => {
    executeEscalationMock.mockResolvedValue({
      escalated: false,
      reason: 'No escalation policy configured',
    });
    sendIncidentNotificationsMock.mockResolvedValue({ success: false, errors: ['push failed'] });
    await expect(
      processEventSideEffect(payload('TRIGGER_ESCALATION_NOTIFICATIONS'))
    ).rejects.toThrow('push failed');
  });

  it.each([
    ['no enabled external channels', { success: true, outcome: 'SKIPPED' }],
    ['quiet-hours suppression', { success: true, outcome: 'SKIPPED' }],
    ['successful delivery', { success: true, outcome: 'DELIVERED' }],
  ])('completes %s without retrying the outbox job', async (_label, result) => {
    executeEscalationMock.mockResolvedValue({
      escalated: false,
      reason: 'No escalation policy configured',
    });
    sendIncidentNotificationsMock.mockResolvedValue(result);
    await expect(
      processEventSideEffect(payload('TRIGGER_ESCALATION_NOTIFICATIONS'))
    ).resolves.toBeUndefined();
  });

  it('retries a typed transient notification provider failure', async () => {
    executeEscalationMock.mockResolvedValue({
      escalated: false,
      reason: 'No escalation policy configured',
    });
    sendIncidentNotificationsMock.mockResolvedValue({
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      errors: ['provider unavailable'],
    });
    await expect(
      processEventSideEffect(payload('TRIGGER_ESCALATION_NOTIFICATIONS'))
    ).rejects.toThrow('provider unavailable');
  });

  it('completes a typed permanent notification failure without endless retries', async () => {
    executeEscalationMock.mockResolvedValue({
      escalated: false,
      reason: 'No escalation policy configured',
    });
    sendIncidentNotificationsMock.mockResolvedValue({
      success: false,
      outcome: 'PERMANENT_FAILURE',
      errors: ['provider credentials are invalid'],
    });
    await expect(
      processEventSideEffect(payload('TRIGGER_ESCALATION_NOTIFICATIONS'))
    ).resolves.toBeUndefined();
  });

  it('keeps team assignment intent and recipients distinct from a generic update', async () => {
    sendIncidentNotificationsMock.mockResolvedValue({ success: true, outcome: 'DELIVERED' });
    await processEventSideEffect(payload('INCIDENT_ASSIGNED_TO_TEAM_NOTIFICATION', 'NOTIFICATION'));
    expect(sendIncidentNotificationsMock).toHaveBeenCalledWith('inc-1', 'updated', [], undefined, {
      intent: 'ASSIGNED_TO_TEAM',
      eventAt: new Date('2026-08-28T07:00:00.000Z'),
      status: undefined,
    });
  });

  it('keeps created webhook lifecycle state even if the incident has since resolved', async () => {
    prismaMock.incident.findUnique.mockResolvedValue({
      id: 'inc-1',
      title: 'Incident',
      description: null,
      status: 'RESOLVED',
      urgency: 'HIGH',
      priority: 'P1',
      serviceId: 'svc-1',
      service: { id: 'svc-1', name: 'Service' },
      assignee: null,
      createdAt: new Date('2026-08-26T12:00:00Z'),
      acknowledgedAt: null,
      resolvedAt: new Date('2026-08-26T12:01:00Z'),
    });
    triggerWebhooksForServiceMock.mockResolvedValue(undefined);
    await processEventSideEffect(payload('TRIGGER_WEBHOOK', 'WEBHOOK'));
    expect(triggerWebhooksForServiceMock).toHaveBeenCalledWith(
      'svc-1',
      'incident.created',
      expect.objectContaining({ status: 'OPEN' }),
      '2026-08-28T07:00:00.000Z',
      { expectedStatus: undefined, escalationGeneration: undefined }
    );
  });

  it('retries partial webhook delivery failures', async () => {
    prismaMock.incident.findUnique.mockResolvedValue({
      id: 'inc-1',
      title: 'Incident',
      description: null,
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      serviceId: 'svc-1',
      service: { id: 'svc-1', name: 'Service' },
      assignee: null,
      createdAt: new Date('2026-08-26T12:00:00Z'),
      acknowledgedAt: null,
      resolvedAt: null,
    });
    triggerWebhooksForServiceMock.mockResolvedValue({ attempted: 2, failed: 1 });
    await expect(processEventSideEffect(payload('TRIGGER_WEBHOOK', 'WEBHOOK'))).rejects.toThrow(
      'failed for 1 delivery target'
    );
  });

  it('replays the queued lifecycle state instead of leaking a newer current state into webhooks', async () => {
    prismaMock.incident.findUnique.mockResolvedValue({
      id: 'inc-1',
      title: 'Incident',
      description: null,
      status: 'RESOLVED',
      urgency: 'HIGH',
      priority: 'P1',
      visibility: 'PUBLIC',
      serviceId: 'svc-1',
      service: { id: 'svc-1', name: 'Service' },
      assignee: null,
      createdAt: new Date('2026-08-28T06:00:00.000Z'),
      acknowledgedAt: new Date('2026-08-28T06:01:00.000Z'),
      resolvedAt: new Date('2026-08-28T06:02:00.000Z'),
    });
    triggerWebhooksForServiceMock.mockResolvedValue(undefined);
    await processEventSideEffect(
      payload('LIFECYCLE_WEBHOOK', 'WEBHOOK', {
        command: 'ACKNOWLEDGE',
        source: 'REST_API',
        previousStatus: 'OPEN',
        status: 'ACKNOWLEDGED',
        transitionAt: '2026-08-28T06:01:00.000Z',
        snoozedUntil: null,
      })
    );
    expect(triggerWebhooksForServiceMock).toHaveBeenCalledWith(
      'svc-1',
      'incident.acknowledged',
      expect.objectContaining({ id: 'inc-1', status: 'ACKNOWLEDGED' }),
      '2026-08-28T07:00:00.000Z',
      { expectedStatus: 'ACKNOWLEDGED', escalationGeneration: undefined }
    );
  });

  it('lets lifecycle notification failures escape to the durable job retry path', async () => {
    sendIncidentNotificationsMock.mockRejectedValue(new Error('notification unavailable'));
    await expect(
      processEventSideEffect(
        payload('LIFECYCLE_USER_NOTIFICATION', 'NOTIFICATION', {
          command: 'RESOLVE',
          source: 'WEB',
          previousStatus: 'ACKNOWLEDGED',
          status: 'RESOLVED',
          transitionAt: '2026-08-28T06:02:00.000Z',
          snoozedUntil: null,
        })
      )
    ).rejects.toThrow('notification unavailable');
  });

  it('passes the committed lifecycle generation into personal and service delivery', async () => {
    const lifecycle = {
      command: 'RESOLVE' as const,
      source: 'EVENT' as const,
      previousStatus: 'ACKNOWLEDGED' as const,
      status: 'RESOLVED' as const,
      transitionAt: '2026-08-28T06:02:00.000Z',
      snoozedUntil: null,
    };
    sendIncidentNotificationsMock.mockResolvedValue({ success: true, outcome: 'DELIVERED' });
    sendServiceNotificationsMock.mockResolvedValue({ success: true });

    await processEventSideEffect(
      payload('LIFECYCLE_USER_NOTIFICATION', 'PERSONAL_NOTIFICATION', lifecycle)
    );
    await processEventSideEffect(
      payload('LIFECYCLE_SERVICE_NOTIFICATION', 'SERVICE_NOTIFICATION', lifecycle)
    );

    expect(sendIncidentNotificationsMock).toHaveBeenCalledWith('inc-1', 'resolved', [], undefined, {
      eventAt: new Date(lifecycle.transitionAt),
      status: 'RESOLVED',
    });
    expect(sendServiceNotificationsMock).toHaveBeenCalledWith('inc-1', 'resolved', {
      eventAt: new Date(lifecycle.transitionAt),
      escalationGeneration: undefined,
      expectedStatus: 'RESOLVED',
    });
  });

  it('recreates an archived war-room on reopen before syncing the OPEN state', async () => {
    prismaMock.incident.findUnique.mockResolvedValue({ status: 'OPEN' });
    createIncidentWarRoomMock.mockResolvedValue({
      success: true,
      channelId: 'C123',
      channelName: 'incident-123',
    });
    postWarRoomUpdateMock.mockResolvedValue({ success: true });
    updateWarRoomTopicMock.mockResolvedValue({ success: true });
    await processEventSideEffect(
      payload('LIFECYCLE_WAR_ROOM_ENSURE', 'WAR_ROOM', {
        command: 'REOPEN',
        source: 'WEB',
        previousStatus: 'RESOLVED',
        status: 'OPEN',
        transitionAt: '2026-08-28T07:00:00.000Z',
        snoozedUntil: null,
      })
    );
    expect(createIncidentWarRoomMock).toHaveBeenCalledWith('inc-1');
    expect(postWarRoomUpdateMock).toHaveBeenCalledWith('inc-1', '🔄 *Status updated to OPEN*');
    expect(updateWarRoomTopicMock).toHaveBeenCalledWith('inc-1', 'OPEN');
  });

  it('does not recreate a war-room for a stale reopen after the incident resolved again', async () => {
    prismaMock.incident.findUnique.mockResolvedValue({ status: 'RESOLVED' });
    await processEventSideEffect(
      payload('LIFECYCLE_WAR_ROOM_ENSURE', 'WAR_ROOM', {
        command: 'REOPEN',
        source: 'WEB',
        previousStatus: 'RESOLVED',
        status: 'OPEN',
        transitionAt: '2026-08-28T07:00:00.000Z',
        snoozedUntil: null,
      })
    );
    expect(createIncidentWarRoomMock).not.toHaveBeenCalled();
    expect(postWarRoomUpdateMock).not.toHaveBeenCalled();
  });

  it('does not archive a war-room when an old resolve effect runs after reopen', async () => {
    prismaMock.incident.findUnique.mockResolvedValue({ status: 'OPEN', resolvedAt: null });
    await processEventSideEffect(
      payload('LIFECYCLE_WAR_ROOM_ARCHIVE', 'WAR_ROOM', {
        command: 'RESOLVE',
        source: 'WEB',
        previousStatus: 'ACKNOWLEDGED',
        status: 'RESOLVED',
        transitionAt: '2026-08-28T06:02:00.000Z',
        snoozedUntil: null,
      })
    );
    expect(archiveWarRoomChannelMock).not.toHaveBeenCalled();
  });

  it('does not let an older resolve archive a newer resolve generation', async () => {
    prismaMock.incident.findUnique.mockResolvedValue({
      status: 'RESOLVED',
      resolvedAt: new Date('2026-08-28T07:10:00.000Z'),
    });
    await processEventSideEffect(
      payload('LIFECYCLE_WAR_ROOM_ARCHIVE', 'WAR_ROOM', {
        command: 'RESOLVE',
        source: 'WEB',
        previousStatus: 'ACKNOWLEDGED',
        status: 'RESOLVED',
        transitionAt: '2026-08-28T06:02:00.000Z',
        snoozedUntil: null,
      })
    );
    expect(archiveWarRoomChannelMock).not.toHaveBeenCalled();
  });

  it('archives the war-room only for the still-current resolve transition', async () => {
    prismaMock.incident.findUnique.mockResolvedValue({
      status: 'RESOLVED',
      resolvedAt: new Date('2026-08-28T06:02:00.000Z'),
    });
    archiveWarRoomChannelMock.mockResolvedValue({ success: true });
    await processEventSideEffect(
      payload('LIFECYCLE_WAR_ROOM_ARCHIVE', 'WAR_ROOM', {
        command: 'RESOLVE',
        source: 'WEB',
        previousStatus: 'ACKNOWLEDGED',
        status: 'RESOLVED',
        transitionAt: '2026-08-28T06:02:00.000Z',
        snoozedUntil: null,
      })
    );
    expect(archiveWarRoomChannelMock).toHaveBeenCalledWith('inc-1');
  });

  it('rejects an unknown effect instead of silently completing it', async () => {
    const invalid = {
      ...payload('ACK_SLACK', 'SLACK'),
      effect: 'UNKNOWN_EFFECT',
    } as unknown as EventSideEffectPayload;
    await expect(processEventSideEffect(invalid)).rejects.toThrow(
      /Unknown EVENT_SIDE_EFFECT effect/
    );
  });
});