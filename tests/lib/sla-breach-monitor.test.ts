import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkSLABreaches,
  formatBreachWarning,
  type BreachWarning,
} from '@/lib/sla-breach-monitor';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';

vi.mock('@/lib/notification-control-plane', () => ({
  enqueueCentralNotification: vi.fn().mockResolvedValue({
    id: 'notification_test',
    created: true,
    delivered: true,
  }),
}));
vi.mock('@/lib/slack', () => ({
  configuredSlackWebhookUrl: vi.fn(() => undefined),
}));

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  default: {
    incident: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    incidentEvent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('sla-breach-monitor', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const { default: prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.incidentEvent.findMany).mockResolvedValue([]);
  });

  describe('checkSLABreaches', () => {
    it('returns empty warnings when no active incidents', async () => {
      const { default: prisma } = await import('@/lib/prisma');
      vi.mocked(prisma.incident.findMany).mockResolvedValue([]);

      const result = await checkSLABreaches();

      expect(result.warnings).toHaveLength(0);
      expect(result.activeIncidentCount).toBe(0);
      expect(result.warningCount).toBe(0);
    });

    it('detects ack breach warning when incident is nearing ack SLA', async () => {
      const { default: prisma } = await import('@/lib/prisma');

      // Set current time
      const now = new Date('2026-01-05T12:00:00Z');
      vi.setSystemTime(now);

      // Incident created 12 minutes ago with 15 min ack target = 3 min remaining
      const createdAt = new Date(now.getTime() - 12 * 60 * 1000);

      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        {
          id: 'inc-1',
          title: 'Test Incident',
          serviceId: 'svc-1',
          urgency: 'HIGH',
          status: 'OPEN',
          createdAt,
          acknowledgedAt: null,
          dedupKey: null,
          escalationProcessingAt: null,
          snoozedUntil: null,
          snoozeReason: null,
          service: {
            id: 'svc-1',
            name: 'Test Service',
            targetAckMinutes: 15,
            targetResolveMinutes: 120,
            slackWebhookUrl: null,
            serviceNotifyOnSlaBreach: true,
          },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);

      const result = await checkSLABreaches();

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].breachType).toBe('ack');
      expect(result.warnings[0].timeRemainingMs).toBeCloseTo(3 * 60 * 1000, -3);
    });

    it('detects resolve breach warning when incident is nearing resolve SLA', async () => {
      const { default: prisma } = await import('@/lib/prisma');

      const now = new Date('2026-01-05T12:00:00Z');
      vi.setSystemTime(now);

      // Incident created 110 minutes ago with 120 min resolve target = 10 min remaining
      const createdAt = new Date(now.getTime() - 110 * 60 * 1000);

      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        {
          id: 'inc-1',
          title: 'Test Incident',
          serviceId: 'svc-1',
          urgency: 'MEDIUM',
          status: 'ACKNOWLEDGED',
          createdAt,
          acknowledgedAt: new Date(now.getTime() - 100 * 60 * 1000),
          dedupKey: null,
          escalationProcessingAt: null,
          snoozedUntil: null,
          snoozeReason: null,
          service: {
            id: 'svc-1',
            name: 'Test Service',
            targetAckMinutes: 15,
            targetResolveMinutes: 120,
            slackWebhookUrl: null,
            serviceNotifyOnSlaBreach: true,
          },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);

      const result = await checkSLABreaches();

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].breachType).toBe('resolve');
    });

    it('does not warn for incidents well before SLA deadline', async () => {
      const { default: prisma } = await import('@/lib/prisma');

      const now = new Date('2026-01-05T12:00:00Z');
      vi.setSystemTime(now);

      // Incident created 5 minutes ago with 15 min ack target = 10 min remaining (outside 5 min warning)
      const createdAt = new Date(now.getTime() - 5 * 60 * 1000);

      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        {
          id: 'inc-1',
          title: 'Test Incident',
          serviceId: 'svc-1',
          urgency: 'LOW',
          status: 'OPEN',
          createdAt,
          acknowledgedAt: null,
          service: {
            id: 'svc-1',
            name: 'Test Service',
            targetAckMinutes: 15,
            targetResolveMinutes: 120,
            slackWebhookUrl: null,
          },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);

      const result = await checkSLABreaches();

      expect(result.warnings).toHaveLength(0);
    });

    it('does not create an SLA Slack intent without a configured target', async () => {
      const { default: prisma } = await import('@/lib/prisma');
      const now = new Date('2026-01-05T12:00:00Z');
      vi.setSystemTime(now);
      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        {
          id: 'inc-1',
          title: 'Test Incident',
          serviceId: 'svc-1',
          urgency: 'HIGH',
          status: 'OPEN',
          createdAt: new Date(now.getTime() - 12 * 60 * 1000),
          acknowledgedAt: null,
          dedupKey: null,
          escalationProcessingAt: null,
          snoozedUntil: null,
          snoozeReason: null,
          service: {
            id: 'svc-1',
            name: 'Test Service',
            targetAckMinutes: 15,
            targetResolveMinutes: 120,
            slackChannel: '   ',
            slackWebhookUrl: null,
            serviceNotificationChannels: ['SLACK'],
            serviceNotifyOnSlaBreach: true,
            webhookIntegrations: [],
          },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);

      await expect(checkSLABreaches()).resolves.toMatchObject({ warningCount: 1 });
      expect(enqueueCentralNotification).not.toHaveBeenCalled();
    });

    it('does not commit the SLA dedupe marker when intent materialization fails', async () => {
      const { default: prisma } = await import('@/lib/prisma');
      const now = new Date('2026-01-05T12:00:00Z');
      vi.setSystemTime(now);
      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        {
          id: 'inc-1',
          title: 'Test Incident',
          serviceId: 'svc-1',
          urgency: 'HIGH',
          status: 'OPEN',
          createdAt: new Date(now.getTime() - 12 * 60 * 1000),
          acknowledgedAt: null,
          dedupKey: null,
          escalationProcessingAt: null,
          snoozedUntil: null,
          snoozeReason: null,
          service: {
            id: 'svc-1',
            name: 'Test Service',
            targetAckMinutes: 15,
            targetResolveMinutes: 120,
            slackChannel: 'C123',
            slackWebhookUrl: null,
            serviceNotificationChannels: ['SLACK'],
            serviceNotifyOnSlaBreach: true,
            webhookIntegrations: [],
          },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);
      vi.mocked(enqueueCentralNotification).mockRejectedValueOnce(new Error('database unavailable'));

      await expect(checkSLABreaches()).rejects.toThrow('database unavailable');
      expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
    });

    it('deduplicates SLA ACK and RESOLVE breach events when already logged', async () => {
      const { default: prisma } = await import('@/lib/prisma');

      const now = new Date('2026-01-05T12:00:00Z');
      vi.setSystemTime(now);

      // Incident created 3 hours ago (both 15m ack and 120m resolve targets breached)
      const createdAt = new Date(now.getTime() - 180 * 60 * 1000);

      vi.mocked(prisma.incident.findMany).mockResolvedValue([
        {
          id: 'inc-1',
          title: 'Breached Incident',
          serviceId: 'svc-1',
          urgency: 'HIGH',
          status: 'OPEN',
          createdAt,
          acknowledgedAt: null,
          service: {
            id: 'svc-1',
            name: 'Test Service',
            targetAckMinutes: 15,
            targetResolveMinutes: 120,
            serviceNotifyOnSlaBreach: true,
          },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.incident.findMany>>);

      // Existing breach events in DB
      vi.mocked(prisma.incidentEvent.findMany).mockResolvedValue([
        { incidentId: 'inc-1', message: '🚨 SLA ACK Breached: target was 15 min' },
        { incidentId: 'inc-1', message: '🚨 SLA RESOLVE Breached: target was 120 min' },
      ] as unknown as Awaited<ReturnType<typeof prisma.incidentEvent.findMany>>);

      const result = await checkSLABreaches();

      // No new warnings or duplicate events created
      expect(result.warnings).toHaveLength(0);
      expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('formatBreachWarning', () => {
    it('formats ack warning correctly', () => {
      const warning: BreachWarning = {
        incidentId: 'inc-1',
        title: 'Test',
        serviceId: 'svc-1',
        serviceName: 'Test Service',
        breachType: 'ack',
        timeRemainingMs: 3 * 60 * 1000, // 3 minutes
        targetMinutes: 15,
        urgency: 'HIGH',
        status: 'OPEN',
        createdAt: new Date(),
      };

      const result = formatBreachWarning(warning);

      expect(result).toContain('Acknowledgment');
      expect(result).toContain('3 min');
      expect(result).toContain('15 min');
    });

    it('formats resolve warning correctly', () => {
      const warning: BreachWarning = {
        incidentId: 'inc-1',
        title: 'Test',
        serviceId: 'svc-1',
        serviceName: 'Test Service',
        breachType: 'resolve',
        timeRemainingMs: 10 * 60 * 1000, // 10 minutes
        targetMinutes: 120,
        urgency: 'MEDIUM',
        status: 'ACKNOWLEDGED',
        createdAt: new Date(),
      };

      const result = formatBreachWarning(warning);

      expect(result).toContain('Resolution');
      expect(result).toContain('10 min');
      expect(result).toContain('120 min');
    });
  });
});
