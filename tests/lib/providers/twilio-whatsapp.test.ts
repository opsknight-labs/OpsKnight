import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendIncidentWhatsApp, sendWhatsApp } from '@/lib/whatsapp';
import { getWhatsAppConfig, getSMSConfig } from '@/lib/notification-providers';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: vi.fn(),
    },
    incident: {
      findUnique: vi.fn(),
    },
    notificationProvider: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/env-validation', () => ({
  getBaseUrl: () => 'https://test.example.com',
}));

vi.mock('@/lib/encrypted-provider-config', () => ({
  decryptProviderConfig: vi.fn((_provider: string, config: Record<string, unknown>) =>
    Promise.resolve(config)
  ),
  encryptProviderConfig: vi.fn((_provider: string, config: Record<string, unknown>) =>
    Promise.resolve(config)
  ),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockMessagesCreate = vi.fn();
vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  })),
}));

describe('Twilio WhatsApp Transport Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SMS-OFF + WhatsApp-ON Configuration', () => {
    it('allows WhatsApp to be enabled when Twilio SMS row has enabled: false', async () => {
      (
        prisma.notificationProvider.findUnique as unknown as ReturnType<typeof vi.fn>
      ).mockImplementation((args: unknown) => {
        const queryArgs = args as { where?: { provider?: string } };
        if (queryArgs?.where?.provider === 'twilio') {
          return Promise.resolve({
            id: 'twilio-prov-1',
            provider: 'twilio',
            enabled: false, // Twilio SMS disabled
            config: {
              accountSid: 'AC_MOCK_123',
              authToken: 'AUTH_TOKEN_SECRET_123',
              fromNumber: '+15005550006',
              whatsappNumber: '+14155238886',
              whatsappEnabled: true,
            },
          } as never);
        }
        return Promise.resolve(null);
      });

      const smsConfig = await getSMSConfig();
      expect(smsConfig.enabled).toBe(false);

      const waConfig = await getWhatsAppConfig();
      expect(waConfig.enabled).toBe(true);
      expect(waConfig.provider).toBe('twilio');
      expect(waConfig.whatsappNumber).toBe('+14155238886');
      expect(waConfig.whatsappContentSid).toBeUndefined();
    });

    it('disables WhatsApp when whatsappEnabled is explicitly false', async () => {
      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'twilio-prov-1',
        provider: 'twilio',
        enabled: true,
        config: {
          accountSid: 'AC_MOCK_123',
          authToken: 'AUTH_TOKEN_SECRET_123',
          whatsappNumber: '+14155238886',
          whatsappEnabled: false,
        },
      } as never);

      const waConfig = await getWhatsAppConfig();
      expect(waConfig.enabled).toBe(false);
    });
  });

  describe('Template vs Session Modes', () => {
    beforeEach(() => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-wa-1',
        phoneNumber: '+15551234567',
        name: 'Ops Responder',
      } as never);

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-wa-1',
        title: 'Core DB Latency Spike',
        urgency: 'HIGH',
        service: { name: 'Billing API' },
      } as never);
    });

    it('delivers via Content Template API when whatsappContentSid is configured', async () => {
      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'twilio-prov-1',
        provider: 'twilio',
        enabled: true,
        config: {
          accountSid: 'AC_MOCK_123',
          authToken: 'AUTH_TOKEN_SECRET_123',
          whatsappNumber: '+14155238886',
          whatsappContentSid: 'HX_APPROVED_TEMPLATE_SID',
          whatsappEnabled: true,
        },
      } as never);

      mockMessagesCreate.mockResolvedValueOnce({ sid: 'SM_WA_TEMPLATE_123' });

      const result = await sendIncidentWhatsApp('user-wa-1', 'inc-wa-1', 'triggered');

      expect(result.success).toBe(true);
      expect(result.messageSid).toBe('SM_WA_TEMPLATE_123');
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'whatsapp:+14155238886',
          to: 'whatsapp:+15551234567',
          contentSid: 'HX_APPROVED_TEMPLATE_SID',
          contentVariables: expect.any(String),
        })
      );
    });

    it('delivers via Session Text API when whatsappContentSid is omitted', async () => {
      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'twilio-prov-1',
        provider: 'twilio',
        enabled: true,
        config: {
          accountSid: 'AC_MOCK_123',
          authToken: 'AUTH_TOKEN_SECRET_123',
          whatsappNumber: '+14155238886',
          whatsappEnabled: true,
          // No content SID
        },
      } as never);

      mockMessagesCreate.mockResolvedValueOnce({ sid: 'SM_WA_SESSION_456' });

      const result = await sendIncidentWhatsApp('user-wa-1', 'inc-wa-1', 'triggered');

      expect(result.success).toBe(true);
      expect(result.messageSid).toBe('SM_WA_SESSION_456');
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'whatsapp:+14155238886',
          to: 'whatsapp:+15551234567',
          body: expect.stringContaining('Core DB Latency Spike'),
        })
      );
      expect(mockMessagesCreate).not.toHaveBeenCalledWith(
        expect.objectContaining({ contentSid: expect.anything() })
      );
    });
  });

  describe('Error Classification & Metadata Preservation', () => {
    beforeEach(() => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-wa-1',
        phoneNumber: '+15551234567',
        name: 'Ops Responder',
      } as never);

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-wa-1',
        title: 'Core DB Latency Spike',
        urgency: 'HIGH',
        service: { name: 'Billing API' },
      } as never);

      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'twilio-prov-1',
        provider: 'twilio',
        enabled: true,
        config: {
          accountSid: 'AC_MOCK_123',
          authToken: 'AUTH_TOKEN_SECRET_123',
          whatsappNumber: '+14155238886',
          whatsappEnabled: true,
        },
      } as never);
    });

    it('captures 429 rate limit with retryAfterMs and flags as retryable', async () => {
      const rateLimitError = new Error('Too Many Requests');
      Object.assign(rateLimitError, { status: 429, code: 20429 });
      mockMessagesCreate.mockRejectedValueOnce(rateLimitError);

      const result = await sendIncidentWhatsApp('user-wa-1', 'inc-wa-1', 'triggered');

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(429);
      expect(result.errorCode).toBe('20429');
      expect(result.retryAfterMs).toBe(60_000);
      expect(result.retryable).toBe(true);
    });

    it('captures 63016 24-hour session window expired as non-retryable with template guidance', async () => {
      const windowError = new Error('Failed to send freeform message outside 24h window');
      Object.assign(windowError, { status: 400, code: 63016 });
      mockMessagesCreate.mockRejectedValueOnce(windowError);

      const result = await sendIncidentWhatsApp('user-wa-1', 'inc-wa-1', 'triggered');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('63016');
      expect(result.retryable).toBe(false);
      expect(result.error).toContain('63016');
      expect(result.error).toContain('Content Template SID');
    });

    it('captures 500 server error and flags as retryable', async () => {
      const serverError = new Error('Internal Server Error');
      Object.assign(serverError, { status: 500, code: 50000 });
      mockMessagesCreate.mockRejectedValueOnce(serverError);

      const result = await sendIncidentWhatsApp('user-wa-1', 'inc-wa-1', 'triggered');

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.retryable).toBe(true);
    });

    it('sendWhatsApp generic helper preserves 429 and retryable flags', async () => {
      const rateLimitError = new Error('Too Many Requests');
      Object.assign(rateLimitError, { status: 429, code: 20429 });
      mockMessagesCreate.mockRejectedValueOnce(rateLimitError);

      const result = await sendWhatsApp('+15551234567', 'Test WhatsApp Message');

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(429);
      expect(result.errorCode).toBe('20429');
      expect(result.retryAfterMs).toBe(60_000);
      expect(result.retryable).toBe(true);
    });
  });

  describe('Security & Secret Hygiene', () => {
    it('never logs authToken or raw secrets on error', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-wa-1',
        phoneNumber: '+15551234567',
      } as never);
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-wa-1',
        title: 'Alert',
        service: { name: 'App' },
      } as never);

      const secretToken = 'AUTH_TOKEN_SECRET_123';
      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'twilio-prov-1',
        provider: 'twilio',
        enabled: true,
        config: {
          accountSid: 'AC_MOCK_123',
          authToken: secretToken,
          whatsappNumber: '+14155238886',
          whatsappEnabled: true,
        },
      } as never);

      mockMessagesCreate.mockRejectedValueOnce(new Error('Connection failure'));

      await sendIncidentWhatsApp('user-wa-1', 'inc-wa-1', 'triggered');

      const allLogCalls = [
        ...vi.mocked(logger.error).mock.calls,
        ...vi.mocked(logger.warn).mock.calls,
        ...vi.mocked(logger.info).mock.calls,
      ];

      for (const call of allLogCalls) {
        const loggedString = JSON.stringify(call);
        expect(loggedString).not.toContain(secretToken);
      }
    });
  });
});
