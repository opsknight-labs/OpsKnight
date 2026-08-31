/**
 * Comprehensive Test Suite for Notification and Escalation System
 *
 * Tests cover:
 * - Service notification isolation
 * - Escalation logic (schedule, team, user)
 * - Slack integration (OAuth and webhook)
 * - Webhook integrations (Google Chat, Teams, Discord)
 * - WhatsApp integration
 * - Team lead functionality
 * - Channel priority
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { sendServiceNotifications } from '@/lib/service-notifications';
import { executeEscalation, resolveEscalationTarget } from '@/lib/escalation';
import { sendSlackNotification, sendSlackMessageToChannel } from '@/lib/slack';
import {
  formatGoogleChatPayload,
  formatMicrosoftTeamsPayload,
  formatDiscordPayload,
} from '@/lib/webhooks';
import { sendIncidentWhatsApp } from '@/lib/whatsapp';
import { getUserNotificationChannels, sendIncidentNotifications } from '@/lib/user-notifications';
import * as notificationProviders from '@/lib/notification-providers';
import * as sms from '@/lib/sms';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
vi.mock('@/lib/notification-control-plane', () => ({
  enqueueCentralNotification: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    service: { findUnique: vi.fn() },
    incident: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    notification: { create: vi.fn(), findMany: vi.fn() },
    backgroundJob: { findUnique: vi.fn(), upsert: vi.fn() },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    onCallSchedule: { findUnique: vi.fn() },
    team: { findUnique: vi.fn() },
    teamMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    slackIntegration: { findFirst: vi.fn() },
    incidentEvent: { create: vi.fn() },
    $transaction: vi.fn(arg => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(prisma);
    }),
  },
}));

describe('Notification System Tests', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.notification.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.backgroundJob.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.backgroundJob.upsert).mockResolvedValue({} as never);
    vi.mocked(enqueueCentralNotification).mockResolvedValue({
      id: 'notification_test',
      created: true,
      delivered: true,
    });
  });

  describe('Service Notification Isolation', () => {
    it('should send service notifications using only service-configured channels', async () => {
      const serviceId = 'svc-1';
      const incidentId = 'inc-1';

      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: serviceId,
        name: 'Test Service',
        serviceNotificationChannels: ['SLACK'],
        slackWebhookUrl: 'https://hooks.slack.com/test',
        policy: null,
      } as never); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        title: 'Test Incident',
        serviceId: serviceId,
        status: 'OPEN',
        urgency: 'HIGH',
        createdAt: new Date('2026-08-30T12:00:00.000Z'),
        updatedAt: new Date('2026-08-30T12:00:00.000Z'),
        acknowledgedAt: null,
        resolvedAt: null,
        assignee: null,
        service: {
          id: serviceId,
          name: 'Test Service',
          serviceNotificationChannels: ['SLACK'],
          slackWebhookUrl: 'https://hooks.slack.com/test',
          webhookIntegrations: [],
        },
      } as never); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notif-1' } as never); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await sendServiceNotifications(incidentId, 'triggered');

      expect(result.success).toBe(true);
      expect(enqueueCentralNotification).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'SLACK', incidentId })
      );
    });
  });

  describe('Incident Notifications & Lifecycle Routing', () => {
    it('keeps service delivery isolated when there are no personal recipients', async () => {
      const incidentId = 'inc-1';
      const serviceId = 'svc-1';

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        title: 'Test Incident',
        status: 'OPEN',
        urgency: 'HIGH',
        priority: 'P1',
        serviceId,
        assigneeId: null,
        assignee: null,
        watchers: [],
        team: null,
        createdAt: new Date('2026-08-30T12:00:00.000Z'),
        updatedAt: new Date('2026-08-30T12:00:00.000Z'),
        acknowledgedAt: null,
        resolvedAt: null,
        currentEscalationStep: null,
        nextEscalationAt: null,
        escalationStatus: null,
        service: {
          id: serviceId,
          name: 'Test Service',
          slackWebhookUrl: null,
          serviceNotificationChannels: ['SLACK'],
          team: null,
        },
      } as never); // eslint-disable-line @typescript-eslint/no-explicit-any

      const serviceNotifications = await import('@/lib/service-notifications');
      const serviceSpy = vi
        .spyOn(serviceNotifications, 'sendServiceNotifications')
        .mockResolvedValue({ success: true });

      const result = await sendIncidentNotifications(incidentId, 'triggered');

      expect(serviceSpy).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, outcome: 'SKIPPED' });
      serviceSpy.mockRestore();
    });

    it('should restrict external push/SMS alerts for acknowledged events to assignee and watchers, while team gets in-app notifications', async () => {
      const incidentId = 'inc-2';
      const serviceId = 'svc-2';
      const assigneeUserId = 'user-assignee';
      const watcherUserId = 'user-watcher';
      const offDutyTeamMemberId = 'user-team-member';
      const createdAt = new Date('2026-08-30T12:00:00.000Z');
      const acknowledgedAt = new Date('2026-08-30T12:01:00.000Z');

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        title: 'DB Latency High',
        status: 'ACKNOWLEDGED',
        urgency: 'HIGH',
        priority: 'P1',
        serviceId,
        assigneeId: assigneeUserId,
        assignee: { id: assigneeUserId, name: 'Assignee User' },
        watchers: [{ id: 'w-1', incidentId, userId: watcherUserId, role: 'FOLLOWER' }],
        team: null,
        createdAt,
        updatedAt: acknowledgedAt,
        acknowledgedAt,
        resolvedAt: null,
        currentEscalationStep: null,
        nextEscalationAt: null,
        escalationStatus: null,
        service: {
          id: serviceId,
          name: 'DB Service',
          slackWebhookUrl: null,
          serviceNotificationChannels: [],
          team: {
            id: 'team-1',
            name: 'Backend Team',
            members: [
              { userId: assigneeUserId, user: { id: assigneeUserId, name: 'Assignee User' } },
              {
                userId: offDutyTeamMemberId,
                user: { id: offDutyTeamMemberId, name: 'Off Duty Member' },
              },
            ],
          },
        },
      } as unknown as Awaited<ReturnType<typeof prisma.incident.findUnique>>);

      vi.mocked(prisma.user.findMany).mockResolvedValue([
        {
          id: assigneeUserId,
          emailNotificationsEnabled: false,
          smsNotificationsEnabled: false,
          pushNotificationsEnabled: true,
          whatsappNotificationsEnabled: false,
          phoneNumber: null,
          email: 'assignee@example.com',
          timeZone: 'UTC',
          quietHoursEnabled: false,
        },
        {
          id: watcherUserId,
          emailNotificationsEnabled: false,
          smsNotificationsEnabled: false,
          pushNotificationsEnabled: true,
          whatsappNotificationsEnabled: false,
          phoneNumber: null,
          email: 'watcher@example.com',
          timeZone: 'UTC',
          quietHoursEnabled: false,
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.user.findMany>>);

      const inAppModule = await import('@/lib/in-app-notifications');
      const inAppSpy = vi
        .spyOn(inAppModule, 'createInAppNotifications')
        .mockResolvedValue(
          [] as unknown as Awaited<ReturnType<typeof inAppModule.createInAppNotifications>>
        );

      const notifModule = await import('@/lib/notifications');
      const sendNotifSpy = vi
        .spyOn(notifModule, 'sendNotification')
        .mockResolvedValue({ success: true, outcome: 'DELIVERED', notificationId: 'notif-1' });

      vi.spyOn(notificationProviders, 'isChannelAvailable').mockResolvedValue(true);

      const result = await sendIncidentNotifications(incidentId, 'acknowledged');

      expect(result.success).toBe(true);
      expect(inAppSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userIds: expect.arrayContaining([assigneeUserId, watcherUserId, offDutyTeamMemberId]),
          title: 'Incident Acknowledged',
        })
      );
      const notifiedUserIds = sendNotifSpy.mock.calls.map(call => call[1]);
      expect(notifiedUserIds).toContain(assigneeUserId);
      expect(notifiedUserIds).toContain(watcherUserId);
      expect(notifiedUserIds).not.toContain(offDutyTeamMemberId);

      inAppSpy.mockRestore();
      sendNotifSpy.mockRestore();
    });
  });

  describe('Schedule Escalation - Overlapping Layer Precedence', () => {
    const scheduleId = 'sched-1';
    const user1Id = 'user-1';
    const user2Id = 'user-2';

    const scheduleWithLayers = (layer1Priority?: number, layer2Priority?: number) => ({
      id: scheduleId,
      name: 'Test Schedule',
      timeZone: 'UTC',
      layers: [
        {
          id: 'layer-1',
          name: 'Layer 1',
          start: new Date('2024-01-01'),
          rotationLengthHours: 24,
          priority: layer1Priority,
          users: [{ userId: user1Id, position: 0, user: { name: 'User 1', status: 'ACTIVE' } }],
        },
        {
          id: 'layer-2',
          name: 'Layer 2',
          start: new Date('2024-01-01'),
          rotationLengthHours: 24,
          priority: layer2Priority,
          users: [{ userId: user2Id, position: 0, user: { name: 'User 2', status: 'ACTIVE' } }],
        },
      ],
      overrides: [],
    });

    it('should page a single user when equal-priority layers overlap', async () => {
      vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValue(scheduleWithLayers() as never);
      const users = await resolveEscalationTarget('SCHEDULE', scheduleId, new Date());
      expect(users).toEqual([user1Id]);
    });

    it('should page the higher-priority layer when layers overlap', async () => {
      vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValue(
        scheduleWithLayers(0, 10) as never
      );
      const users = await resolveEscalationTarget('SCHEDULE', scheduleId, new Date());
      expect(users).toEqual([user2Id]);
    });

    it('should page every override user when overrides are active', async () => {
      const now = new Date();
      vi.mocked(prisma.onCallSchedule.findUnique).mockResolvedValue({
        ...scheduleWithLayers(),
        overrides: [
          {
            id: 'ovr-1',
            userId: user1Id,
            user: { name: 'User 1' },
            start: new Date(now.getTime() - 3600_000),
            end: new Date(now.getTime() + 3600_000),
            replacesUserId: null,
          },
          {
            id: 'ovr-2',
            userId: user2Id,
            user: { name: 'User 2' },
            start: new Date(now.getTime() - 3600_000),
            end: new Date(now.getTime() + 3600_000),
            replacesUserId: null,
          },
        ],
      } as never);
      const users = await resolveEscalationTarget('SCHEDULE', scheduleId, now);
      expect(users).toEqual(expect.arrayContaining([user1Id, user2Id]));
    });
  });

  describe('Team Lead Functionality', () => {
    it('should return only team lead when notifyOnlyTeamLead is true', async () => {
      const teamLeadId = 'lead-1';
      const teamId = 'team-1';
      vi.mocked(prisma.team.findUnique).mockResolvedValue({
        id: teamId,
        teamLeadId,
        members: [{ userId: teamLeadId }],
      } as never);
      vi.mocked(prisma.teamMember.findFirst).mockResolvedValue({ userId: teamLeadId } as never);
      const users = await resolveEscalationTarget('TEAM', teamId, new Date(), true);
      expect(users).toHaveLength(1);
      expect(users[0]).toBe(teamLeadId);
    });

    it('should return no users when team lead has team notifications disabled', async () => {
      const teamLeadId = 'lead-2';
      const teamId = 'team-2';
      vi.mocked(prisma.team.findUnique).mockResolvedValue({
        id: teamId,
        teamLeadId,
        members: [],
      } as never);
      vi.mocked(prisma.teamMember.findFirst).mockResolvedValue(null);
      const users = await resolveEscalationTarget('TEAM', teamId, new Date(), true);
      expect(users).toHaveLength(0);
    });

    it('should return all team members when notifyOnlyTeamLead is false', async () => {
      const teamLeadId = 'lead-1';
      const member1Id = 'member-1';
      const member2Id = 'member-2';
      const teamId = 'team-1';
      vi.mocked(prisma.team.findUnique).mockResolvedValue({
        id: teamId,
        teamLeadId,
        members: [{ userId: teamLeadId }, { userId: member1Id }, { userId: member2Id }],
      } as never);
      const users = await resolveEscalationTarget('TEAM', teamId, new Date(), false);
      expect(users.length).toBe(3);
      expect(users).toContain(teamLeadId);
      expect(users).toContain(member1Id);
      expect(users).toContain(member2Id);
    });
  });

  describe('Slack Integration', () => {
    it('should send Slack notification via webhook', async () => {
      const incident = {
        id: 'test-id',
        title: 'Test Incident',
        status: 'OPEN',
        urgency: 'HIGH',
        serviceName: 'Test Service',
        assigneeName: 'Test User',
      };
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const result = await sendSlackNotification(
        'triggered',
        incident,
        undefined,
        'https://hooks.slack.com/test'
      );
      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should send Slack message to channel via API', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
      const incident = {
        id: 'test-id',
        title: 'Test Incident',
        status: 'OPEN',
        urgency: 'HIGH',
        serviceName: 'Test Service',
        assigneeName: 'Test User',
      };
      vi.mocked(prisma.slackIntegration.findFirst).mockResolvedValue(null);
      const result = await sendSlackMessageToChannel('#incidents', incident, 'triggered', true);
      expect(result.success).toBe(false);
    });
  });

  describe('Webhook Formatters', () => {
    it('should format Google Chat payload correctly', () => {
      const incident = {
        id: 'test-id',
        title: 'Test Incident',
        description: 'Test description',
        status: 'OPEN',
        urgency: 'HIGH',
        service: { id: 'svc-1', name: 'Test Service' },
        assignee: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
        createdAt: new Date(),
        acknowledgedAt: null,
        resolvedAt: null,
      };
      const payload = formatGoogleChatPayload(incident, 'triggered', 'https://example.com');
      expect(payload.cards).toBeDefined();
      expect(payload.cards[0].header.title).toContain('Incident Triggered');
      expect(payload.cards[0].header.subtitle).toBe('Test Service • HIGH');
    });

    it('should format Microsoft Teams payload correctly', () => {
      const incident = {
        id: 'test-id',
        title: 'Test Incident',
        description: 'Test description',
        status: 'OPEN',
        urgency: 'HIGH',
        service: { id: 'svc-1', name: 'Test Service' },
        assignee: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
        createdAt: new Date(),
        acknowledgedAt: null,
        resolvedAt: null,
      };
      const payload = formatMicrosoftTeamsPayload(incident, 'triggered', 'https://example.com');
      expect(payload.type).toBe('message');
      expect(payload.attachments).toBeDefined();
      expect(payload.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    });

    it('should format Discord payload correctly', () => {
      const incident = {
        id: 'test-id',
        title: 'Test Incident',
        description: 'Test description',
        status: 'OPEN',
        urgency: 'HIGH',
        service: { id: 'svc-1', name: 'Test Service' },
        assignee: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
        createdAt: new Date(),
        acknowledgedAt: null,
        resolvedAt: null,
      };
      const payload = formatDiscordPayload(incident, 'triggered', 'https://example.com');
      expect(payload.embeds).toBeDefined();
      expect(payload.embeds[0].title).toContain('Incident Triggered');
      expect(payload.embeds[0].color).toBe(0xd32f2f);
    });
  });

  describe('WhatsApp Integration', () => {
    it('should send WhatsApp notification via Twilio', async () => {
      const userId = 'user-1';
      const incidentId = 'inc-1';
      const serviceId = 'svc-1';
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: userId,
        phoneNumber: '+1234567890',
        name: 'Test User',
      } as never);
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        title: 'Test Incident',
        urgency: 'HIGH',
        service: { id: serviceId, name: 'Test Service' },
        assignee: null,
      } as never);
      vi.spyOn(notificationProviders, 'getWhatsAppConfig').mockResolvedValue({
        enabled: true,
        provider: 'twilio',
        accountSid: 'ACtest-sid',
        authToken: 'test-token',
        whatsappNumber: '+1234567890',
        whatsappContentSid: 'test-content-sid',
      } as never);
      const result = await sendIncidentWhatsApp(userId, incidentId, 'triggered');
      if (!result.success) console.error('WhatsApp Test Failed with error:', result.error);
      expect(result.success).toBe(true);
    });
  });

  describe('Channel Priority', () => {
    it('should return channels in priority order: PUSH → SMS → WhatsApp → EMAIL', async () => {
      const userId = 'user-1';
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: userId,
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: true,
        pushNotificationsEnabled: true,
        whatsappNotificationsEnabled: true,
      } as never);
      vi.spyOn(notificationProviders, 'isChannelAvailable').mockResolvedValue(true);
      vi.spyOn(notificationProviders, 'getSMSConfig').mockResolvedValue({
        enabled: true,
        provider: 'twilio',
      } as never);
      const channels = await getUserNotificationChannels(userId);
      const pushIndex = channels.indexOf('PUSH');
      const smsIndex = channels.indexOf('SMS');
      const whatsappIndex = channels.indexOf('WHATSAPP');
      const emailIndex = channels.indexOf('EMAIL');
      if (pushIndex !== -1 && smsIndex !== -1) expect(pushIndex).toBeLessThan(smsIndex);
      if (smsIndex !== -1 && whatsappIndex !== -1) expect(smsIndex).toBeLessThan(whatsappIndex);
      if (whatsappIndex !== -1 && emailIndex !== -1) expect(whatsappIndex).toBeLessThan(emailIndex);
    });
  });

  describe('Escalation Recipient Routing', () => {
    it('should execute a configured escalation step without overriding user preferences', async () => {
      const userId = 'user-1';
      const incidentId = 'inc-1';
      const serviceId = 'svc-1';
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        title: 'Test Incident',
        status: 'OPEN',
        currentEscalationStep: 0,
        escalationStatus: 'ESCALATING',
        service: {
          id: serviceId,
          policy: {
            id: 'policy-1',
            steps: [
              {
                stepOrder: 0,
                delayMinutes: 0,
                targetType: 'USER',
                targetUserId: userId,
                notificationChannels: ['SMS'],
                targetUser: { name: 'Test User' },
              },
            ],
          },
        },
      } as never);
      vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as never);
      vi.mocked(prisma.incident.update).mockResolvedValue({} as never);
      const smsSpy = vi.spyOn(sms, 'sendIncidentSMS');
      smsSpy.mockResolvedValue({ success: true });
      const notificationModule = await import('@/lib/user-notifications');
      const sendUserSpy = vi.spyOn(notificationModule, 'sendUserNotification').mockResolvedValue({
        success: true,
        channelsUsed: [],
      } as never);
      const result = await executeEscalation(incidentId, 0);
      expect(result.escalated).toBe(true);
      expect(sendUserSpy).toHaveBeenCalledWith(incidentId, userId, expect.any(String), ['SMS'], {
        eventKey: 'ESCALATION:inc-1:policy-1:0:0',
      });
    });
  });
});
