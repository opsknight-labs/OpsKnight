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
    expect(mockResendSend).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: 'custom-idemp-key-xyz',
    });
  });

  it.each([
    [undefined, 60_000],
    [{ 'retry-after': '120' }, 120_000],
    [{ 'retry-after': 'unknown' }, 60_000],
  ])('handles a 429 rate limit with response headers %j', async (headers, expectedDelay) => {
    mockResendSend.mockResolvedValueOnce({
      error: {
        statusCode: 429,
        name: 'rate_limit_exceeded',
        message: 'Too many requests',
      },
      headers,
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
    expect(result.retryAfterMs).toBe(expectedDelay);
    expect(result.error).toBe('Too many requests');
  });

  it('preserves message headers and idempotency through the installed SDK', async () => {
    const { Resend } = await vi.importActual<typeof import('resend')>('resend');
    const sdk = new Resend(config.apiKey);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ id: 'resend-msg-wire' }));
    try {
      mockResendSend.mockImplementationOnce(sdk.emails.send.bind(sdk.emails));
      const headers = { 'List-Unsubscribe': '<https://example.com/unsubscribe>' };
      const result = await sendEmail(
        {
          to: 'oncall@example.com',
          subject: 'Incident Alert',
          html: '<p>Alert</p>',
          idempotencyKey: 'incident-alert-wire',
          headers,
        },
        config
      );

      expect(result).toMatchObject({ success: true, providerMessageId: 'resend-msg-wire' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, request] = fetchMock.mock.calls[0];
      expect(new URL(String(url)).pathname).toBe('/emails');
      expect(new Headers(request?.headers).get('Idempotency-Key')).toBe('incident-alert-wire');
      expect(JSON.parse(String(request?.body))).toMatchObject({
        from: config.fromEmail,
        to: 'oncall@example.com',
        html: '<p>Alert</p>',
        text: 'Alert',
        headers,
      });
    } finally {
      fetchMock.mockRestore();
    }
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

  it('preserves status and code aliases in API error bodies', async () => {
    mockResendSend.mockResolvedValueOnce({
      error: { status: 429, code: 'rate_limit_exceeded', message: 'Too many requests' },
      headers: { 'retry-after': '2' },
    });

    await expect(
      sendEmail(
        { to: 'oncall@example.com', subject: 'Incident Alert', html: '<p>Alert</p>' },
        config
      )
    ).resolves.toMatchObject({
      success: false,
      statusCode: 429,
      errorCode: 'rate_limit_exceeded',
      retryAfterMs: 2_000,
    });
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
