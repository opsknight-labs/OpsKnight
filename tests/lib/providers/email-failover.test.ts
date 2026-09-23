import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail, isSafeEmailFailoverCondition } from '@/lib/email';
import * as notificationProviders from '@/lib/notification-providers';

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

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockResendSend = vi.fn();
class MockResend {
  apiKey: string;
  emails = {
    send: mockResendSend,
  };
  constructor(apiKey?: string) {
    this.apiKey = apiKey || '';
  }
}

vi.mock('resend', () => ({
  default: { Resend: MockResend },
  Resend: MockResend,
}));

const mockSendgridSend = vi.fn();
const mockSendgridSetApiKey = vi.fn();
vi.mock('@sendgrid/mail', () => ({
  default: {
    setApiKey: mockSendgridSetApiKey,
    send: mockSendgridSend,
  },
  setApiKey: mockSendgridSetApiKey,
  send: mockSendgridSend,
}));

const mockSesSend = vi.fn();
class MockSESClient {
  send = mockSesSend;
}
class MockSendEmailCommand {
  input: unknown;
  constructor(input: unknown) {
    this.input = input;
  }
}

vi.mock('@aws-sdk/client-ses', () => ({
  default: {
    SESClient: MockSESClient,
    SendEmailCommand: MockSendEmailCommand,
  },
  SESClient: MockSESClient,
  SendEmailCommand: MockSendEmailCommand,
}));

const mockNodemailerSendMail = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockNodemailerSendMail,
      on: vi.fn(),
    })),
  },
  createTransport: vi.fn(() => ({
    sendMail: mockNodemailerSendMail,
    on: vi.fn(),
  })),
}));

describe('Safe Email Provider Failover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isSafeEmailFailoverCondition', () => {
    it('returns false for successful delivery', () => {
      expect(isSafeEmailFailoverCondition({ success: true })).toBe(false);
    });

    it('returns false for UNKNOWN or ambiguous outcomes to prevent duplicate deliveries', () => {
      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Ambiguous delivery outcome: connection dropped during transmission',
          errorCode: 'UNKNOWN',
        })
      ).toBe(false);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Unconfirmed delivery state',
        })
      ).toBe(false);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Unknown provider response',
        })
      ).toBe(false);
    });

    it('returns false for permanent invalid recipient or malformed payload errors', () => {
      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Invalid recipient address',
          statusCode: 400,
        })
      ).toBe(false);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Recipient rejected: mailbox unavailable',
          statusCode: 550,
        })
      ).toBe(false);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Bad request: malformed email syntax',
          statusCode: 400,
        })
      ).toBe(false);
    });

    it('returns false for non-429 4xx client errors (bad auth, unverified domain)', () => {
      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Forbidden: domain not verified',
          statusCode: 403,
        })
      ).toBe(false);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Unauthorized: invalid API key',
          statusCode: 401,
        })
      ).toBe(false);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Unprocessable entity',
          statusCode: 422,
        })
      ).toBe(false);
    });

    it('returns false for 5xx server/provider errors because delivery may be ambiguous', () => {
      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Internal server error',
          statusCode: 500,
        })
      ).toBe(false);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Bad gateway',
          statusCode: 502,
        })
      ).toBe(false);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Service unavailable',
          statusCode: 503,
        })
      ).toBe(false);
    });

    it('returns true for 429 rate limit errors', () => {
      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Rate limit exceeded',
          statusCode: 429,
          retryAfterMs: 60000,
        })
      ).toBe(true);
    });

    it('returns false for in-flight/ambiguous network and timeout errors (ECONNRESET, ETIMEDOUT, socket hang up)', () => {
      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'connect ECONNRESET 127.0.0.1:465',
          errorCode: 'ECONNRESET',
        })
      ).toBe(false);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Connection timeout after 30000ms',
          errorCode: 'ETIMEDOUT',
        })
      ).toBe(false);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'socket hang up',
        })
      ).toBe(false);
    });

    it('returns true for demonstrably pre-submission errors (ENOTFOUND, ECONNREFUSED, missing package)', () => {
      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'getaddrinfo ENOTFOUND api.resend.com',
          errorCode: 'ENOTFOUND',
        })
      ).toBe(true);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'connect ECONNREFUSED 127.0.0.1:587',
          errorCode: 'ECONNREFUSED',
        })
      ).toBe(true);

      expect(
        isSafeEmailFailoverCondition({
          success: false,
          error: 'Resend package not installed. Run: npm install resend',
        })
      ).toBe(true);
    });
  });

  describe('Sequential Provider Failover Execution', () => {
    it('does not fail over when Resend returns a 500 server error', async () => {
      vi.spyOn(notificationProviders, 'getAllConfiguredEmailProviders').mockResolvedValue([
        {
          provider: 'resend',
          enabled: true,
          apiKey: 're_test_123',
          fromEmail: 'alerts@example.com',
        },
        {
          provider: 'sendgrid',
          enabled: true,
          apiKey: 'SG.test_456',
          fromEmail: 'alerts@example.com',
        },
      ]);

      mockResendSend.mockResolvedValueOnce({
        error: {
          message: 'Resend internal error',
          statusCode: 500,
          name: 'internal_server_error',
        },
      });

      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Incident Alert',
        html: '<p>System Down</p>',
      });

      expect(result.success).toBe(false);
      expect(result.selectedProvider).toBe('resend');
      expect(result.providerAttemptCount).toBe(1);
      expect(mockResendSend).toHaveBeenCalledTimes(1);
      expect(mockSendgridSend).not.toHaveBeenCalled();
    });

    it('halts and does NOT failover if primary provider fails with UNKNOWN delivery', async () => {
      vi.spyOn(notificationProviders, 'getAllConfiguredEmailProviders').mockResolvedValue([
        {
          provider: 'resend',
          enabled: true,
          apiKey: 're_test_123',
          fromEmail: 'alerts@example.com',
        },
        {
          provider: 'sendgrid',
          enabled: true,
          apiKey: 'SG.test_456',
          fromEmail: 'alerts@example.com',
        },
      ]);

      mockResendSend.mockResolvedValueOnce({
        error: {
          message: 'Ambiguous unconfirmed response',
          errorCode: 'UNKNOWN',
        },
      });

      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Incident Alert',
        html: '<p>System Down</p>',
      });

      expect(result.success).toBe(false);
      expect(result.selectedProvider).toBe('resend');
      expect(result.providerAttemptCount).toBe(1);
      // SendGrid must NOT be called to prevent duplicate email
      expect(mockSendgridSend).not.toHaveBeenCalled();
    });

    it('halts and does NOT failover if primary provider fails with 400 invalid recipient', async () => {
      vi.spyOn(notificationProviders, 'getAllConfiguredEmailProviders').mockResolvedValue([
        {
          provider: 'resend',
          enabled: true,
          apiKey: 're_test_123',
          fromEmail: 'alerts@example.com',
        },
        {
          provider: 'sendgrid',
          enabled: true,
          apiKey: 'SG.test_456',
          fromEmail: 'alerts@example.com',
        },
      ]);

      mockResendSend.mockResolvedValueOnce({
        error: {
          message: 'Invalid recipient email address',
          statusCode: 400,
        },
      });

      const result = await sendEmail({
        to: 'invalid-email',
        subject: 'Incident Alert',
        html: '<p>System Down</p>',
      });

      expect(result.success).toBe(false);
      expect(result.selectedProvider).toBe('resend');
      expect(result.providerAttemptCount).toBe(1);
      expect(mockSendgridSend).not.toHaveBeenCalled();
    });

    it('returns aggregate failure when all configured providers fail with safe conditions', async () => {
      vi.spyOn(notificationProviders, 'getAllConfiguredEmailProviders').mockResolvedValue([
        {
          provider: 'resend',
          enabled: true,
          apiKey: 're_test_123',
          fromEmail: 'alerts@example.com',
        },
        {
          provider: 'sendgrid',
          enabled: true,
          apiKey: 'SG.test_456',
          fromEmail: 'alerts@example.com',
        },
      ]);

      mockResendSend.mockResolvedValueOnce({
        error: {
          message: 'Resend rate limited',
          statusCode: 429,
        },
      });

      mockSendgridSend.mockResolvedValueOnce([
        {
          statusCode: 429,
          body: { errors: [{ message: 'SendGrid rate limited' }] },
        },
      ]);

      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Incident Alert',
        html: '<p>System Down</p>',
      });

      expect(result.success).toBe(false);
      expect(result.providerAttemptCount).toBe(2);
      expect(result.error).toContain('All configured email providers failed');
    });

    it('delivers with primary provider without failover when primary succeeds', async () => {
      vi.spyOn(notificationProviders, 'getAllConfiguredEmailProviders').mockResolvedValue([
        {
          provider: 'resend',
          enabled: true,
          apiKey: 're_test_123',
          fromEmail: 'alerts@example.com',
        },
        {
          provider: 'sendgrid',
          enabled: true,
          apiKey: 'SG.test_456',
          fromEmail: 'alerts@example.com',
        },
      ]);

      mockResendSend.mockResolvedValueOnce({
        data: { id: 'resend-msg-success' },
      });

      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Incident Alert',
        html: '<p>System Down</p>',
      });

      expect(result.success).toBe(true);
      expect(result.selectedProvider).toBe('resend');
      expect(result.providerAttemptCount).toBe(1);
      expect(result.fallbackReason).toBeUndefined();
      expect(result.providerMessageId).toBe('resend-msg-success');
      expect(mockSendgridSend).not.toHaveBeenCalled();
    });

    it('fails over to SendGrid when Resend is rate-limited (429)', async () => {
      vi.spyOn(notificationProviders, 'getAllConfiguredEmailProviders').mockResolvedValue([
        {
          provider: 'resend',
          enabled: true,
          apiKey: 're_test_123',
          fromEmail: 'alerts@example.com',
        },
        {
          provider: 'sendgrid',
          enabled: true,
          apiKey: 'SG.test_456',
          fromEmail: 'alerts@example.com',
        },
      ]);

      mockResendSend.mockResolvedValueOnce({
        error: {
          message: 'Rate limit exceeded',
          statusCode: 429,
          name: 'rate_limit_exceeded',
        },
      });

      mockSendgridSend.mockResolvedValueOnce([
        {
          statusCode: 202,
          headers: { 'x-message-id': 'sg-msg-rate-limit-fallback' },
        },
      ]);

      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Incident Alert',
        html: '<p>System Down</p>',
      });

      expect(result.success).toBe(true);
      expect(result.selectedProvider).toBe('sendgrid');
      expect(result.providerAttemptCount).toBe(2);
      expect(result.providerMessageId).toBe('sg-msg-rate-limit-fallback');
    });

    it('does NOT fail over to SES when Resend encounters network ETIMEDOUT (ambiguous outcome)', async () => {
      vi.spyOn(notificationProviders, 'getAllConfiguredEmailProviders').mockResolvedValue([
        {
          provider: 'resend',
          enabled: true,
          apiKey: 're_test_123',
          fromEmail: 'alerts@example.com',
        },
        {
          provider: 'ses',
          enabled: true,
          apiKey: 'aws_secret',
          host: 'us-east-1',
          fromEmail: 'alerts@example.com',
        },
      ]);

      mockResendSend.mockRejectedValueOnce(new Error('connect ETIMEDOUT 127.0.0.1:443'));

      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Incident Alert',
        html: '<p>System Down</p>',
      });

      expect(result.success).toBe(false);
      expect(result.selectedProvider).toBe('resend');
      expect(result.providerAttemptCount).toBe(1);
      expect(mockSesSend).not.toHaveBeenCalled();
    });

    it('fails over to SES when Resend encounters pre-submission ECONNREFUSED error', async () => {
      vi.spyOn(notificationProviders, 'getAllConfiguredEmailProviders').mockResolvedValue([
        {
          provider: 'resend',
          enabled: true,
          apiKey: 're_test_123',
          fromEmail: 'alerts@example.com',
        },
        {
          provider: 'ses',
          enabled: true,
          apiKey: 'aws_secret',
          host: 'us-east-1',
          fromEmail: 'alerts@example.com',
        },
      ]);

      mockResendSend.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:443'));

      mockSesSend.mockResolvedValueOnce({
        MessageId: 'ses-msg-refused-fallback',
      });

      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Incident Alert',
        html: '<p>System Down</p>',
      });

      expect(result.success).toBe(true);
      expect(result.selectedProvider).toBe('ses');
      expect(result.providerAttemptCount).toBe(2);
      expect(result.providerMessageId).toBe('ses-msg-refused-fallback');
    });

    it('honors explicitly providedConfig without querying provider list or failing over', async () => {
      const explicitConfig = {
        provider: 'resend',
        enabled: true,
        apiKey: 're_explicit_key',
        fromEmail: 'alerts@example.com',
      };

      mockResendSend.mockResolvedValueOnce({
        error: {
          message: 'Resend temporary 500 error',
          statusCode: 500,
        },
      });

      const result = await sendEmail(
        {
          to: 'user@example.com',
          subject: 'Incident Alert',
          html: '<p>System Down</p>',
        },
        explicitConfig
      );

      expect(result.success).toBe(false);
      expect(result.selectedProvider).toBe('resend');
      expect(result.providerAttemptCount).toBe(1);
      expect(mockSendgridSend).not.toHaveBeenCalled();
      expect(mockSesSend).not.toHaveBeenCalled();
    });
  });
});
