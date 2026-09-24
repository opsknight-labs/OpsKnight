import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeProviderTest, resolveTestNotificationOutcome } from '@/lib/provider-test-service';
import prisma from '@/lib/prisma';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    notificationProvider: {
      findUnique: vi.fn(),
    },
    notification: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  },
}));

vi.mock('@/lib/encrypted-provider-config', () => ({
  decryptProviderConfig: vi.fn((_provider: string, config: Record<string, unknown>) =>
    Promise.resolve(config)
  ),
}));

vi.mock('@/lib/notification-control-plane', () => ({
  enqueueCentralNotification: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue({ id: 'audit-1' }),
}));

describe('Provider Test Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Outcome State Machine Resolution', () => {
    it('resolves SENT notification status as ACCEPTED with green success: true', async () => {
      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-1',
        status: 'SENT',
        providerMessageId: 'msg-accepted-123',
        errorMsg: null,
        nextAttemptAt: null,
        deliveryAttempts: [
          {
            outcome: 'ACCEPTED',
            provider: 'resend',
            providerMessageId: 'msg-accepted-123',
            errorCode: null,
            errorMessage: null,
          },
        ],
      } as never);

      const result = await resolveTestNotificationOutcome('notif-1', 'resend', 'EMAIL');

      expect(result).toMatchObject({
        status: 'ACCEPTED',
        success: true,
        provider: 'resend',
        channel: 'EMAIL',
        notificationId: 'notif-1',
        providerMessageId: 'msg-accepted-123',
      });
      expect(result.message).toContain('accepted by provider');
    });

    it('resolves DELIVERED notification status as DELIVERED with green success: true', async () => {
      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-deliv-1',
        status: 'DELIVERED',
        providerMessageId: 'msg-delivered-123',
        errorMsg: null,
        nextAttemptAt: null,
        deliveryAttempts: [
          {
            outcome: 'ACCEPTED',
            provider: 'resend',
            providerMessageId: 'msg-delivered-123',
            errorCode: null,
            errorMessage: null,
          },
        ],
      } as never);

      const result = await resolveTestNotificationOutcome('notif-deliv-1', 'resend', 'EMAIL');

      expect(result).toMatchObject({
        status: 'DELIVERED',
        success: true,
        provider: 'resend',
        channel: 'EMAIL',
        notificationId: 'notif-deliv-1',
        providerMessageId: 'msg-delivered-123',
      });
      expect(result.message).toContain('delivered successfully');
    });

    it('resolves PENDING notification without attempt as QUEUED with success: false', async () => {
      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-queued-1',
        status: 'PENDING',
        providerMessageId: null,
        errorMsg: null,
        nextAttemptAt: new Date(Date.now() - 1000),
        deliveryAttempts: [],
      } as never);

      const result = await resolveTestNotificationOutcome('notif-queued-1', 'twilio', 'SMS');

      expect(result).toMatchObject({
        status: 'QUEUED',
        success: false,
        provider: 'twilio',
        channel: 'SMS',
        notificationId: 'notif-queued-1',
      });
      expect(result.message).toContain('enqueued');
      // Must NOT be marked as green success
      expect(result.success).toBe(false);
    });

    it('resolves RATE_LIMITED attempt as DEFERRED with retryAt metadata and success: false', async () => {
      const retryDate = new Date(Date.now() + 60_000);
      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-deferred-1',
        status: 'PENDING',
        providerMessageId: null,
        errorMsg: 'Provider rate-limited delivery',
        nextAttemptAt: retryDate,
        deliveryAttempts: [
          {
            outcome: 'RATE_LIMITED',
            provider: 'twilio',
            providerMessageId: null,
            errorCode: '20429',
            errorMessage: 'Too Many Requests',
          },
        ],
      } as never);

      const result = await resolveTestNotificationOutcome('notif-deferred-1', 'twilio', 'WHATSAPP');

      expect(result).toMatchObject({
        status: 'DEFERRED',
        success: false,
        provider: 'twilio',
        channel: 'WHATSAPP',
        notificationId: 'notif-deferred-1',
        errorCode: '20429',
        retryAt: retryDate.toISOString(),
      });
      expect(result.message).toContain('deferred');
      expect(result.success).toBe(false);
    });

    it('resolves UNKNOWN ambiguous notification as UNKNOWN with success: false', async () => {
      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-unknown-1',
        status: 'UNKNOWN',
        providerMessageId: 'msg-unconfirmed-456',
        errorMsg: 'Ambiguous provider outcome',
        nextAttemptAt: null,
        deliveryAttempts: [
          {
            outcome: 'AMBIGUOUS',
            provider: 'sendgrid',
            providerMessageId: 'msg-unconfirmed-456',
            errorCode: 'ETIMEDOUT',
            errorMessage: 'Connection timed out waiting for receipt',
          },
        ],
      } as never);

      const result = await resolveTestNotificationOutcome('notif-unknown-1', 'sendgrid', 'EMAIL');

      expect(result).toMatchObject({
        status: 'UNKNOWN',
        success: false,
        provider: 'sendgrid',
        channel: 'EMAIL',
        notificationId: 'notif-unknown-1',
        providerMessageId: 'msg-unconfirmed-456',
        errorCode: 'ETIMEDOUT',
      });
      expect(result.message).toContain('unconfirmed');
      expect(result.success).toBe(false);
    });

    it('resolves FAILED notification as FAILED with errorCode and success: false', async () => {
      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-failed-1',
        status: 'FAILED',
        providerMessageId: null,
        errorMsg: 'Authentication failed: Invalid API key',
        nextAttemptAt: null,
        deliveryAttempts: [
          {
            outcome: 'PERMANENT_FAILURE',
            provider: 'resend',
            providerMessageId: null,
            errorCode: 'invalid_api_key',
            errorMessage: 'Authentication failed: Invalid API key',
          },
        ],
      } as never);

      const result = await resolveTestNotificationOutcome('notif-failed-1', 'resend', 'EMAIL');

      expect(result).toMatchObject({
        status: 'FAILED',
        success: false,
        provider: 'resend',
        channel: 'EMAIL',
        notificationId: 'notif-failed-1',
        errorCode: 'invalid_api_key',
      });
      expect(result.message).toContain('Authentication failed');
      expect(result.success).toBe(false);
    });
  });

  describe('executeProviderTest Dispatch Flow', () => {
    const adminUser = {
      id: 'admin-1',
      email: 'admin@opsknight.io',
      phoneNumber: '+15551234567',
      name: 'System Admin',
      role: 'ADMIN',
    };

    it('fails immediately when provider is not configured in database', async () => {
      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue(null);

      const result = await executeProviderTest('ses', adminUser);

      expect(result).toMatchObject({
        status: 'FAILED',
        success: false,
        provider: 'ses',
      });
      expect(result.message).toContain('not configured');
    });

    it('fails immediately when provider is disabled in database', async () => {
      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'prov-1',
        provider: 'sendgrid',
        enabled: false,
        config: {},
      } as never);

      const result = await executeProviderTest('sendgrid', adminUser);

      expect(result).toMatchObject({
        status: 'FAILED',
        success: false,
        provider: 'sendgrid',
      });
      expect(result.message).toContain('disabled');
    });

    it('dispatches email test and returns structured ACCEPTED result', async () => {
      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'prov-resend',
        provider: 'resend',
        enabled: true,
        config: { apiKey: 're_valid_key' },
      } as never);

      vi.mocked(enqueueCentralNotification).mockResolvedValue({
        id: 'notif-resend-test',
        created: true,
        delivered: true,
      } as never);

      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-resend-test',
        status: 'SENT',
        providerMessageId: 'resend-msg-123',
        nextAttemptAt: null,
        errorMsg: null,
        deliveryAttempts: [
          {
            outcome: 'ACCEPTED',
            provider: 'resend',
            providerMessageId: 'resend-msg-123',
            errorCode: null,
            errorMessage: null,
          },
        ],
      } as never);

      const result = await executeProviderTest('resend', adminUser);

      expect(result).toMatchObject({
        status: 'ACCEPTED',
        success: true,
        provider: 'resend',
        channel: 'EMAIL',
        notificationId: 'notif-resend-test',
        providerMessageId: 'resend-msg-123',
      });
      expect(enqueueCentralNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'EMAIL',
          recipientAddress: 'admin@opsknight.io',
          payload: expect.objectContaining({ providerKey: 'resend' }),
        }),
        { dispatchImmediately: true }
      );
    });

    it('dispatches Twilio WhatsApp test using canonical twilio providerKey and returns ACCEPTED', async () => {
      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'prov-twilio',
        provider: 'twilio',
        enabled: true,
        config: {
          accountSid: 'AC_MOCK_123',
          authToken: 'AUTH_TOKEN_SECRET',
          whatsappNumber: '+14155238886',
          whatsappEnabled: true,
        },
      } as never);

      vi.mocked(enqueueCentralNotification).mockResolvedValue({
        id: 'notif-wa-test',
        created: true,
        delivered: true,
      } as never);

      vi.mocked(prisma.notification.findUnique).mockResolvedValue({
        id: 'notif-wa-test',
        status: 'SENT',
        providerMessageId: 'SM_WA_MOCK_789',
        nextAttemptAt: null,
        errorMsg: null,
        deliveryAttempts: [
          {
            outcome: 'ACCEPTED',
            provider: 'twilio',
            providerMessageId: 'SM_WA_MOCK_789',
            errorCode: null,
            errorMessage: null,
          },
        ],
      } as never);

      const result = await executeProviderTest('whatsapp', adminUser);

      expect(result).toMatchObject({
        status: 'ACCEPTED',
        success: true,
        provider: 'twilio',
        channel: 'WHATSAPP',
        notificationId: 'notif-wa-test',
        providerMessageId: 'SM_WA_MOCK_789',
      });
      expect(enqueueCentralNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'WHATSAPP',
          payload: expect.objectContaining({ providerKey: 'twilio' }),
        }),
        { dispatchImmediately: true }
      );
    });

    it('handles skipped notification cleanly with FAILED status and no false green', async () => {
      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'prov-twilio',
        provider: 'twilio',
        enabled: true,
        config: { accountSid: 'AC123', authToken: 'token', fromNumber: '+15005550006' },
      } as never);

      vi.mocked(enqueueCentralNotification).mockResolvedValue({
        id: 'notif-skipped-1',
        created: true,
        skipped: true,
        error: 'Recipient endpoint is unavailable: BOUNCED',
      } as never);

      const result = await executeProviderTest('twilio', adminUser);

      expect(result).toMatchObject({
        status: 'FAILED',
        success: false,
        provider: 'twilio',
        channel: 'SMS',
      });
      expect(result.message).toContain('unavailable');
    });

    it('reports configured Web Push with no recipient device without treating it as a delivery failure', async () => {
      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'prov-web-push',
        provider: 'web-push',
        enabled: true,
        config: { vapidPublicKey: 'public', vapidPrivateKey: 'private' },
      } as never);

      vi.mocked(enqueueCentralNotification).mockResolvedValue({
        id: 'notif-push-no-device',
        created: true,
        skipped: true,
        error: 'No web subscription is registered for the recipient device.',
      } as never);

      const result = await executeProviderTest('web-push', adminUser);

      expect(result).toMatchObject({
        status: 'CONFIGURED_NO_DEVICE',
        success: true,
        provider: 'web-push',
        channel: 'PUSH',
        notificationId: 'notif-push-no-device',
      });
    });
  });
});
