import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from '@/lib/email';
import type { EmailConfig } from '@/lib/notification-providers';

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

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: vi.fn() },
    incident: { findUnique: vi.fn() },
    notificationProvider: { findUnique: vi.fn(), findMany: vi.fn() },
    notification: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Resend Provider Transport Contract', () => {
  const config: EmailConfig = {
    provider: 'resend',
    enabled: true,
    apiKey: 're_valid_key_123',
    fromEmail: 'alerts@example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delivers successfully and returns provider message ID', async () => {
    mockResendSend.mockResolvedValueOnce({
      data: { id: 'resend-msg-12345' },
    });

    const result = await sendEmail(
      {
        to: 'oncall@example.com',
        subject: 'Database connection failed',
        html: '<p>High latency observed</p>',
      },
      config
    );

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('resend-msg-12345');
    expect(result.selectedProvider).toBe('resend');
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'alerts@example.com',
        to: 'oncall@example.com',
        subject: 'Database connection failed',
        html: '<p>High latency observed</p>',
      })
    );
  });

  it('passes idempotency key to Resend when specified', async () => {
    mockResendSend.mockResolvedValueOnce({
      data: { id: 'resend-msg-idemp-1' },
    });

    const result = await sendEmail(
      {
        to: 'oncall@example.com',
        subject: 'Incident Alert',
        html: '<p>Alert</p>',
        idempotencyKey: 'custom-idemp-key-xyz',
      },
      config
    );

    expect(result.success).toBe(true);
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.anything(),
      { idempotencyKey: 'custom-idemp-key-xyz' }
    );
  });

  it('handles 429 rate limit with statusCode 429 and retryAfterMs', async () => {
    mockResendSend.mockResolvedValueOnce({
      error: {
        statusCode: 429,
        name: 'rate_limit_exceeded',
        message: 'Too many requests',
      },
    });

    const result = await sendEmail(
      {
        to: 'oncall@example.com',
        subject: 'Incident Alert',
        html: '<p>Alert</p>',
      },
      config
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.errorCode).toBe('rate_limit_exceeded');
    expect(result.retryAfterMs).toBe(60_000);
    expect(result.error).toBe('Too many requests');
  });

  it('handles API errors with status code and error code', async () => {
    mockResendSend.mockResolvedValueOnce({
      error: {
        statusCode: 403,
        name: 'forbidden',
        message: 'Domain not verified',
      },
    });

    const result = await sendEmail(
      {
        to: 'oncall@example.com',
        subject: 'Incident Alert',
        html: '<p>Alert</p>',
      },
      config
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.errorCode).toBe('forbidden');
    expect(result.error).toBe('Domain not verified');
  });

  it('captures network/exception errors cleanly', async () => {
    mockResendSend.mockRejectedValueOnce(new Error('Connection reset by peer'));

    const result = await sendEmail(
      {
        to: 'oncall@example.com',
        subject: 'Incident Alert',
        html: '<p>Alert</p>',
      },
      config
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection reset by peer');
  });
});
