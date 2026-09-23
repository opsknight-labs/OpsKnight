import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueCentralNotification,
  deliverCentralNotification,
  type CentralNotificationInput,
} from '@/lib/notification-control-plane';
import prisma from '@/lib/prisma';
import * as providerAdmission from '@/lib/provider-admission';
import * as notificationProviders from '@/lib/notification-providers';
import { CircuitBreakers } from '@/lib/circuit-breaker';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  sendIncidentEmail: vi.fn(),
  encrypt: vi.fn(async (value: string) => `encrypted:${value}`),
  decrypt: vi.fn(async (value: string) => value.replace(/^encrypted:/, '')),
}));

const prismaMocks = vi.hoisted(() => {
  const notificationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const attemptCreate = vi.fn().mockResolvedValue({ id: 'att-1' });
  const attemptCount = vi.fn().mockResolvedValue(0);

  return {
    notificationUpdateMany,
    attemptCreate,
    attemptCount,
  };
});

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      create: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: prismaMocks.notificationUpdateMany,
    },
    incident: { findUnique: vi.fn() },
    service: { findUnique: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
    notificationDeliveryAttempt: {
      create: prismaMocks.attemptCreate,
      count: prismaMocks.attemptCount,
    },
    userNotificationEndpoint: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    notificationProvider: { findMany: vi.fn(), findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (operation: unknown) => {
      if (Array.isArray(operation)) {
        return Promise.all(operation);
      }
      if (typeof operation === 'function') {
        return operation({
          notification: { updateMany: prismaMocks.notificationUpdateMany },
          notificationDeliveryAttempt: { create: prismaMocks.attemptCreate },
        });
      }
      return operation;
    }),
  },
}));

vi.mock('@/lib/encryption', () => ({
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
  getEncryptionKey: vi.fn(() => '11'.repeat(32)),
}));

vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>();
  return {
    ...actual,
    sendEmail: mocks.sendEmail,
    sendIncidentEmail: mocks.sendIncidentEmail,
  };
});

vi.mock('@/lib/notification-providers', () => ({
  getAllConfiguredEmailProviders: vi.fn(),
  getStatusPageEmailConfig: vi.fn(),
  getSMSConfig: vi.fn().mockResolvedValue({ provider: 'twilio' }),
  getWhatsAppConfig: vi.fn().mockResolvedValue({ provider: 'twilio' }),
  getPushConfig: vi.fn().mockResolvedValue({ provider: 'webpush' }),
}));

describe('Control Plane Email Provider Failover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.notificationUpdateMany.mockResolvedValue({ count: 1 });
    prismaMocks.attemptCreate.mockResolvedValue({ id: 'att-1' });
    prismaMocks.attemptCount.mockResolvedValue(0);

    vi.spyOn(providerAdmission, 'acquireProviderAdmission').mockResolvedValue({ allowed: true });
    vi.spyOn(providerAdmission, 'acquireProviderConcurrency').mockResolvedValue({
      allowed: true,
      leaseKey: 'lease-key-test',
    });
    vi.spyOn(providerAdmission, 'releaseProviderConcurrency').mockResolvedValue(undefined);
    vi.spyOn(providerAdmission, 'deferProviderAdmission').mockResolvedValue(undefined);
  });

  describe('Ambiguous timeout never causes second provider send', () => {
    it('halts and marks notification UNKNOWN when primary provider encounters ambiguous ETIMEDOUT', async () => {
      const payload = {
        kind: 'EMAIL' as const,
        to: 'alerts@example.com',
        subject: 'Database high load',
        html: '<p>High load</p>',
        emailRoute: ['resend', 'ses'],
      };

      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-ambig-1',
        status: 'PENDING',
        category: 'INCIDENT',
        trafficClass: 'CRITICAL',
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: new Date(Date.now() - 1000),
        nextAttemptAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
        payloadEncrypted: `encrypted:${JSON.stringify(payload)}`,
        sourceType: 'incident',
        sourceId: 'inc-1',
        recipientId: 'user-1',
        templateKey: 'incident-alert',
        claimToken: null,
        fanoutId: null,
      } as never);

      vi.mocked(notificationProviders.getAllConfiguredEmailProviders).mockResolvedValue([
        { provider: 'resend', enabled: true, apiKey: 're_key', fromEmail: 'ops@example.com' },
        { provider: 'ses', enabled: true, apiKey: 'ses_key', host: 'us-east-1', fromEmail: 'ops@example.com' },
      ]);

      // Resend encounters ETIMEDOUT (ambiguous outcome)
      mocks.sendEmail.mockResolvedValueOnce({
        success: false,
        error: 'connect ETIMEDOUT 127.0.0.1:443',
        errorCode: 'ETIMEDOUT',
      });

      const result = await deliverCentralNotification('notif-ambig-1');

      expect(result.success).toBe(true);
      // Resend was called
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
      // SES was NEVER called
      expect(mocks.sendEmail).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ provider: 'ses' })
      );

      // Notification must transition to UNKNOWN in attempt update
      expect(prismaMocks.notificationUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'UNKNOWN',
            errorMsg: expect.stringContaining('Ambiguous provider outcome'),
          }),
        })
      );

      // Attempt recorded as AMBIGUOUS
      expect(prismaMocks.attemptCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          notificationId: 'notif-ambig-1',
          ordinal: 1,
          outcome: 'AMBIGUOUS',
          provider: 'resend',
        }),
      });
    });
  });

  describe('Resend 429 cools down Resend only; subsequent send routes directly to next provider', () => {
    it('defers Resend admission and falls back to SES, then subsequent send skips Resend', async () => {
      const payload1 = {
        kind: 'EMAIL' as const,
        to: 'user1@example.com',
        subject: 'First Alert',
        html: '<p>First Alert</p>',
        emailRoute: ['resend', 'ses'],
      };

      vi.mocked(prisma.notification.findUnique).mockResolvedValueOnce({
        id: 'notif-429-1',
        status: 'PENDING',
        category: 'INCIDENT',
        trafficClass: 'CRITICAL',
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: new Date(Date.now() - 1000),
        nextAttemptAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
        payloadEncrypted: `encrypted:${JSON.stringify(payload1)}`,
        sourceType: 'incident',
        sourceId: 'inc-1',
        recipientId: 'user-1',
        templateKey: 'incident-alert',
        claimToken: null,
        fanoutId: null,
      } as never);

      vi.mocked(notificationProviders.getAllConfiguredEmailProviders).mockResolvedValue([
        { provider: 'resend', enabled: true, apiKey: 're_key', fromEmail: 'ops@example.com' },
        { provider: 'ses', enabled: true, apiKey: 'ses_key', host: 'us-east-1', fromEmail: 'ops@example.com' },
      ]);

      // Attempt 1: Resend returns 429
      mocks.sendEmail.mockResolvedValueOnce({
        success: false,
        error: 'Too Many Requests',
        statusCode: 429,
        retryAfterMs: 60000,
      });

      // Attempt 2: SES succeeds
      mocks.sendEmail.mockResolvedValueOnce({
        success: true,
        providerMessageId: 'ses-success-123',
      });

      const firstDelivery = await deliverCentralNotification('notif-429-1');

      expect(firstDelivery.success).toBe(true);
      expect(mocks.sendEmail).toHaveBeenCalledTimes(2);

      // Verify Resend was cooled down in admission control
      expect(providerAdmission.deferProviderAdmission).toHaveBeenCalledWith(
        'EMAIL',
        'resend',
        expect.any(Date)
      );

      // Now deliver a SECOND notification with the same route ['resend', 'ses']
      // Resend admission now denies entry due to active rate-limit cooldown
      vi.spyOn(providerAdmission, 'acquireProviderAdmission').mockImplementation(
        async (scope, providerKey) => {
          if (providerKey === 'resend') {
            return { allowed: false, retryAt: new Date(Date.now() + 50000), reason: 'RATE_LIMITED' };
          }
          return { allowed: true };
        }
      );

      const payload2 = {
        kind: 'EMAIL' as const,
        to: 'user2@example.com',
        subject: 'Second Alert',
        html: '<p>Second Alert</p>',
        emailRoute: ['resend', 'ses'],
      };

      vi.mocked(prisma.notification.findUnique).mockResolvedValueOnce({
        id: 'notif-429-2',
        status: 'PENDING',
        category: 'INCIDENT',
        trafficClass: 'CRITICAL',
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: new Date(Date.now() - 1000),
        nextAttemptAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
        payloadEncrypted: `encrypted:${JSON.stringify(payload2)}`,
        sourceType: 'incident',
        sourceId: 'inc-1',
        recipientId: 'user-2',
        templateKey: 'incident-alert',
        claimToken: null,
        fanoutId: null,
      } as never);

      mocks.sendEmail.mockResolvedValueOnce({
        success: true,
        providerMessageId: 'ses-direct-456',
      });

      const secondDelivery = await deliverCentralNotification('notif-429-2');

      expect(secondDelivery.success).toBe(true);
      // For the second notification, sendEmail was called ONLY once (directly via SES!)
      expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
      expect(mocks.sendEmail).toHaveBeenLastCalledWith(
        expect.objectContaining({ to: 'user2@example.com' }),
        expect.objectContaining({ provider: 'ses' })
      );
    });
  });

  describe('Resend circuit open skips directly to fallback', () => {
    it('skips Resend and delivers via SES without attempting Resend when Resend circuit is OPEN', async () => {
      // Force Resend's circuit breaker to OPEN
      const resendBreaker = CircuitBreakers.email('resend');
      for (let i = 0; i < 6; i++) {
        await resendBreaker.execute(async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:443');
        }).catch(() => undefined);
      }
      expect(resendBreaker.getState()).toBe('OPEN');

      const payload = {
        kind: 'EMAIL' as const,
        to: 'user@example.com',
        subject: 'Circuit Skip Alert',
        html: '<p>Circuit Skip</p>',
        emailRoute: ['resend', 'ses'],
      };

      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-circuit-1',
        status: 'PENDING',
        category: 'INCIDENT',
        trafficClass: 'CRITICAL',
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: new Date(Date.now() - 1000),
        nextAttemptAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
        payloadEncrypted: `encrypted:${JSON.stringify(payload)}`,
        sourceType: 'incident',
        sourceId: 'inc-1',
        recipientId: 'user-1',
        templateKey: 'incident-alert',
        claimToken: null,
        fanoutId: null,
      } as never);

      vi.mocked(notificationProviders.getAllConfiguredEmailProviders).mockResolvedValue([
        { provider: 'resend', enabled: true, apiKey: 're_key', fromEmail: 'ops@example.com' },
        { provider: 'ses', enabled: true, apiKey: 'ses_key', host: 'us-east-1', fromEmail: 'ops@example.com' },
      ]);

      mocks.sendEmail.mockResolvedValueOnce({
        success: true,
        providerMessageId: 'ses-circuit-fallback-123',
      });

      const result = await deliverCentralNotification('notif-circuit-1');

      expect(result.success).toBe(true);
      // Resend was completely skipped; sendEmail called ONLY for SES!
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
      expect(mocks.sendEmail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ provider: 'ses' })
      );

      // Clean up circuit breaker
      resendBreaker.reset();
    });
  });

  describe('Fallback attempts appear in durable history', () => {
    it('records both failed Resend attempt and successful SES attempt in NotificationDeliveryAttempt', async () => {
      const payload = {
        kind: 'EMAIL' as const,
        to: 'user@example.com',
        subject: 'Durable Ledger Alert',
        html: '<p>Ledger Alert</p>',
        emailRoute: ['resend', 'ses'],
      };

      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-ledger-1',
        status: 'PENDING',
        category: 'INCIDENT',
        trafficClass: 'CRITICAL',
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: new Date(Date.now() - 1000),
        nextAttemptAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
        payloadEncrypted: `encrypted:${JSON.stringify(payload)}`,
        sourceType: 'incident',
        sourceId: 'inc-1',
        recipientId: 'user-1',
        templateKey: 'incident-alert',
        claimToken: null,
        fanoutId: null,
      } as never);

      prismaMocks.attemptCount
        .mockResolvedValueOnce(0) // First attempt ordinal count
        .mockResolvedValueOnce(1); // Second attempt ordinal count

      vi.mocked(notificationProviders.getAllConfiguredEmailProviders).mockResolvedValue([
        { provider: 'resend', enabled: true, apiKey: 're_key', fromEmail: 'ops@example.com' },
        { provider: 'ses', enabled: true, apiKey: 'ses_key', host: 'us-east-1', fromEmail: 'ops@example.com' },
      ]);

      // Attempt 1: Resend fails with 500
      mocks.sendEmail.mockResolvedValueOnce({
        success: false,
        error: 'Internal Server Error',
        statusCode: 500,
      });

      // Attempt 2: SES succeeds
      mocks.sendEmail.mockResolvedValueOnce({
        success: true,
        providerMessageId: 'ses-msg-ledger-999',
      });

      const result = await deliverCentralNotification('notif-ledger-1');

      expect(result.success).toBe(true);

      // Verify Attempt 1 was written to notificationDeliveryAttempt:
      expect(prismaMocks.attemptCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          notificationId: 'notif-ledger-1',
          ordinal: 1,
          outcome: 'RETRYABLE_FAILURE',
          provider: 'resend',
          errorMessage: 'Internal Server Error',
        }),
      });

      // Verify Attempt 2 was written to notificationDeliveryAttempt:
      expect(prismaMocks.attemptCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          notificationId: 'notif-ledger-1',
          ordinal: 2,
          outcome: 'ACCEPTED',
          provider: 'ses',
          providerMessageId: 'ses-msg-ledger-999',
        }),
      });
    });
  });

  describe('Route does not change when provider settings change after notification has already been queued', () => {
    it('freezes emailRoute at enqueue time and delivers according to frozen route', async () => {
      // At enqueue time: Resend and SES are enabled
      vi.mocked(notificationProviders.getAllConfiguredEmailProviders).mockResolvedValueOnce([
        { provider: 'resend', enabled: true, apiKey: 're_key', fromEmail: 'ops@example.com' },
        { provider: 'ses', enabled: true, apiKey: 'ses_key', host: 'us-east-1', fromEmail: 'ops@example.com' },
      ]);

      const input: CentralNotificationInput = {
        category: 'INCIDENT',
        channel: 'EMAIL',
        recipientType: 'USER',
        recipientAddress: 'user@example.com',
        templateKey: 'incident-alert',
        sourceType: 'incident',
        sourceId: 'inc-99',
        eventKey: 'inc-99-event',
        displayMessage: 'Incident opened',
        payload: {
          kind: 'EMAIL',
          to: 'user@example.com',
          subject: 'Queue Test',
          html: '<p>Queue Test</p>',
        },
      };

      let storedPayloadEncrypted = '';
      vi.mocked(prisma.notification.create).mockImplementationOnce((async (args: { data: Record<string, unknown> }) => {
        storedPayloadEncrypted = args.data.payloadEncrypted as string;
        return {
          id: 'notif-queued-frozen',
          status: 'PENDING',
          ...args.data,
        };
      }) as never);

      // Enqueue notification with dispatchImmediately: false
      const intent = await enqueueCentralNotification(input, { dispatchImmediately: false });

      expect(intent.created).toBe(true);

      // Verify the encrypted payload contains the frozen emailRoute
      const decrypted = JSON.parse(storedPayloadEncrypted.replace(/^encrypted:/, ''));
      expect(decrypted.emailRoute).toEqual(['resend', 'ses']);
      expect(decrypted.providerKey).toBe('resend');

      // Now: admin reconfigures providers! Resend is deleted, only SMTP is enabled
      vi.mocked(notificationProviders.getAllConfiguredEmailProviders).mockResolvedValue([
        { provider: 'smtp', enabled: true, host: 'smtp.example.com', port: 587, user: 'u', password: 'p', fromEmail: 'smtp@example.com' },
      ]);

      // Claim and deliver the notification
      vi.mocked(prisma.notification.findUnique).mockResolvedValueOnce({
        id: 'notif-queued-frozen',
        status: 'PENDING',
        category: 'INCIDENT',
        trafficClass: 'CRITICAL',
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: new Date(Date.now() - 1000),
        nextAttemptAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
        payloadEncrypted: storedPayloadEncrypted,
        sourceType: 'incident',
        sourceId: 'inc-99',
        recipientId: 'user-1',
        templateKey: 'incident-alert',
        claimToken: null,
        fanoutId: null,
      } as never);

      // Provider configs when delivering - Resend exists
      vi.mocked(notificationProviders.getAllConfiguredEmailProviders).mockResolvedValue([
        { provider: 'resend', enabled: true, apiKey: 're_key', fromEmail: 'ops@example.com' },
        { provider: 'ses', enabled: true, apiKey: 'ses_key', host: 'us-east-1', fromEmail: 'ops@example.com' },
      ]);

      mocks.sendEmail.mockResolvedValueOnce({
        success: true,
        providerMessageId: 'resend-msg-frozen-route',
      });

      const result = await deliverCentralNotification('notif-queued-frozen');

      expect(result.success).toBe(true);
      // It executed with 'resend' from the frozen route, NOT 'smtp'!
      expect(mocks.sendEmail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ provider: 'resend' })
      );
    });

    it('PINNED_PROVIDER_UNAVAILABLE safely fails over to subsequent provider', async () => {
      // Setup: route has Resend and SES, but Resend config is unavailable at delivery time
      const due = new Date(Date.now() - 5000);
      const payload = {
        kind: 'INCIDENT_EMAIL' as const,
        userId: 'user-1',
        incidentId: 'incident-1',
        eventType: 'triggered' as const,
        eventAt: due.toISOString(),
        durableMessage: 'Alert message',
        emailRoute: ['resend', 'ses'],
      };

      vi.mocked(prisma.notification.findUnique).mockResolvedValueOnce({
        id: 'notif-pinned-unavail',
        status: 'PENDING',
        category: 'INCIDENT',
        trafficClass: 'CRITICAL',
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: due,
        nextAttemptAt: due,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
        payloadEncrypted: `encrypted:${JSON.stringify(payload)}`,
        sourceType: 'incident',
        sourceId: 'incident-1',
        recipientId: 'user-1',
        templateKey: 'incident-alert',
        claimToken: null,
        fanoutId: null,
      } as never);

      vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
        status: 'OPEN',
        updatedAt: due,
        acknowledgedAt: null,
        resolvedAt: null,
        currentEscalationStep: 0,
        escalationGeneration: null,
      } as never);

      // Only SES is configured in database
      vi.mocked(notificationProviders.getAllConfiguredEmailProviders).mockResolvedValue([
        { provider: 'ses', enabled: true, apiKey: 'ses_sec', accessKeyId: 'ses_key', fromEmail: 'ops@example.com' },
      ]);

      mocks.sendIncidentEmail.mockResolvedValueOnce({
        success: true,
        providerMessageId: 'ses-msg-pinned-fallback',
      });

      const result = await deliverCentralNotification('notif-pinned-unavail');

      expect(result.success).toBe(true);
      expect(mocks.sendIncidentEmail).toHaveBeenCalledTimes(1);
      expect(mocks.sendIncidentEmail).toHaveBeenCalledWith(
        'user-1',
        'incident-1',
        'triggered',
        'notif-pinned-unavail',
        'Alert message',
        expect.objectContaining({ provider: 'ses' })
      );
    });

    it('enforces attempt budget and stops multi-provider fallback when maxAttempts is reached', async () => {
      // Setup: 4-provider route, but maxAttempts = 3
      const due = new Date(Date.now() - 5000);
      const payload = {
        kind: 'EMAIL' as const,
        to: 'user@example.com',
        subject: 'Multi-failover test',
        html: '<p>Test</p>',
        emailRoute: ['resend', 'sendgrid', 'ses', 'smtp'],
      };

      vi.mocked(prisma.notification.findUnique).mockResolvedValueOnce({
        id: 'notif-max-attempts-route',
        status: 'PENDING',
        category: 'INCIDENT',
        trafficClass: 'CRITICAL',
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: due,
        nextAttemptAt: due,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
        payloadEncrypted: `encrypted:${JSON.stringify(payload)}`,
        sourceType: 'incident',
        sourceId: 'inc-budget',
        recipientId: 'user-1',
        templateKey: 'incident-alert',
        claimToken: null,
        fanoutId: null,
      } as never);

      prismaMocks.attemptCount
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2);

      vi.mocked(notificationProviders.getAllConfiguredEmailProviders).mockResolvedValue([
        { provider: 'resend', enabled: true, apiKey: 're_key', fromEmail: 'ops@example.com' },
        { provider: 'sendgrid', enabled: true, apiKey: 'sg_key', fromEmail: 'ops@example.com' },
        { provider: 'ses', enabled: true, apiKey: 'ses_sec', accessKeyId: 'ses_key', fromEmail: 'ops@example.com' },
        { provider: 'smtp', enabled: true, host: 'smtp.example.com', port: 587, user: 'u', password: 'p', fromEmail: 'ops@example.com' },
      ]);

      // All 3 dispatches fail with safe 500 errors
      mocks.sendEmail
        .mockResolvedValueOnce({ success: false, statusCode: 500, error: 'Resend 500 error' })
        .mockResolvedValueOnce({ success: false, statusCode: 500, error: 'SendGrid 500 error' })
        .mockResolvedValueOnce({ success: false, statusCode: 500, error: 'SES 500 error' })
        .mockResolvedValueOnce({ success: true, providerMessageId: 'smtp-should-not-be-called' });

      const attemptLedger: Array<{ ordinal: number; outcome: string; provider: string }> = [];
      vi.mocked(prisma.notificationDeliveryAttempt.create).mockImplementation(((args: {
        data: { ordinal: number; outcome: string; provider: string };
      }) => {
        attemptLedger.push({
          ordinal: args.data.ordinal,
          outcome: args.data.outcome,
          provider: args.data.provider,
        });
        return Promise.resolve({} as never);
      }) as never);

      const result = await deliverCentralNotification('notif-max-attempts-route');

      expect(result.success).toBe(false);
      // Only 3 attempts must be executed, SMTP (4th) must NOT be executed!
      expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
      expect(attemptLedger).toHaveLength(3);
      expect(attemptLedger[0]).toMatchObject({ ordinal: 1, outcome: 'RETRYABLE_FAILURE', provider: 'resend' });
      expect(attemptLedger[1]).toMatchObject({ ordinal: 2, outcome: 'RETRYABLE_FAILURE', provider: 'sendgrid' });
      expect(attemptLedger[2]).toMatchObject({ ordinal: 3, outcome: 'PERMANENT_FAILURE', provider: 'ses' });

      // Notification marked FAILED with attempts = 3
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'notif-max-attempts-route' }),
          data: expect.objectContaining({
            status: 'FAILED',
            attempts: 3,
          }),
        })
      );
    });
  });
});
