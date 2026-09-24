import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from '@/lib/email';
import type { EmailConfig } from '@/lib/notification-providers';

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

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: vi.fn() },
    incident: { findUnique: vi.fn() },
    notificationProvider: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SendGrid Provider Transport Contract', () => {
  const validConfig: EmailConfig = {
    provider: 'sendgrid',
    enabled: true,
    apiKey: 'SG.test_key_123',
    fromEmail: 'alerts@example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delivers successfully and extracts provider message ID from headers', async () => {
    mockSendgridSend.mockResolvedValueOnce([
      {
        statusCode: 202,
        headers: { 'x-message-id': 'sg-msg-id-789' },
      },
    ]);

    const result = await sendEmail(
      {
        to: 'engineer@example.com',
        subject: 'High CPU Utilization',
        html: '<p>CPU > 90%</p>',
      },
      validConfig
    );

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('sg-msg-id-789');
    expect(result.selectedProvider).toBe('sendgrid');
    expect(mockSendgridSetApiKey).toHaveBeenCalledWith('SG.test_key_123');
    expect(mockSendgridSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'alerts@example.com',
        to: 'engineer@example.com',
        subject: 'High CPU Utilization',
        html: '<p>CPU > 90%</p>',
      })
    );
  });

  it('returns early error if API key is missing or empty', async () => {
    const incompleteConfig: EmailConfig = {
      provider: 'sendgrid',
      enabled: true,
      apiKey: '',
      fromEmail: 'alerts@example.com',
    };

    const result = await sendEmail(
      {
        to: 'engineer@example.com',
        subject: 'High CPU Utilization',
        html: '<p>CPU > 90%</p>',
      },
      incompleteConfig
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('SendGrid API key is not configured');
    expect(mockSendgridSend).not.toHaveBeenCalled();
  });

  it('handles SendGrid API error responses with statusCode and error body', async () => {
    mockSendgridSend.mockRejectedValueOnce({
      message: 'The from address does not match a verified Sender Identity',
      code: 403,
      response: {
        statusCode: 403,
        body: { errors: [{ message: 'Sender not verified' }] },
      },
    });

    const result = await sendEmail(
      {
        to: 'engineer@example.com',
        subject: 'High CPU Utilization',
        html: '<p>CPU > 90%</p>',
      },
      validConfig
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.error).toContain('Sender not verified');
  });

  it('extracts retryAfterMs when SendGrid returns 429 rate limit', async () => {
    mockSendgridSend.mockRejectedValueOnce({
      message: 'Rate limit reached',
      response: {
        statusCode: 429,
        headers: { 'retry-after': '30' },
        body: { errors: [{ message: 'Rate limit reached' }] },
      },
    });

    const result = await sendEmail(
      {
        to: 'engineer@example.com',
        subject: 'High CPU Utilization',
        html: '<p>CPU > 90%</p>',
      },
      validConfig
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.retryAfterMs).toBe(30_000);
  });
});
