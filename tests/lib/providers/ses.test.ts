import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from '@/lib/email';
import type { EmailConfig } from '@/lib/notification-providers';

const mockSesSend = vi.fn();
class MockSESClient {
  config: Record<string, unknown>;
  constructor(config: Record<string, unknown>) {
    this.config = config;
  }
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

describe('Amazon SES Provider Transport Contract', () => {
  const validConfig: EmailConfig = {
    provider: 'ses',
    enabled: true,
    apiKey: 'aws_secret_key_abc',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    host: 'us-east-1',
    fromEmail: 'ses-alerts@example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delivers successfully and returns MessageId', async () => {
    mockSesSend.mockResolvedValueOnce({
      MessageId: 'ses-message-id-999',
    });

    const result = await sendEmail(
      {
        to: 'recipient@example.com',
        subject: 'Service Restored',
        html: '<p>All systems normal</p>',
      },
      validConfig
    );

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('ses-message-id-999');
    expect(result.selectedProvider).toBe('ses');
    expect(mockSesSend).toHaveBeenCalled();
  });

  it('fails early if configuration is missing required parameters', async () => {
    const incompleteConfig: EmailConfig = {
      provider: 'ses',
      enabled: true,
      apiKey: '',
      host: '',
      fromEmail: '',
    };

    const result = await sendEmail(
      {
        to: 'recipient@example.com',
        subject: 'Service Restored',
        html: '<p>All systems normal</p>',
      },
      incompleteConfig
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Amazon SES configuration incomplete');
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('handles SES Throttling error with statusCode 429 and retryAfterMs', async () => {
    mockSesSend.mockRejectedValueOnce({
      name: 'ThrottlingException',
      message: 'Maximum sending rate exceeded',
      $metadata: { httpStatusCode: 400 },
    });

    const result = await sendEmail(
      {
        to: 'recipient@example.com',
        subject: 'Service Restored',
        html: '<p>All systems normal</p>',
      },
      validConfig
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.errorCode).toBe('ThrottlingException');
    expect(result.retryAfterMs).toBe(60_000);
  });

  it('propagates general AWS SES errors with status code and error message', async () => {
    mockSesSend.mockRejectedValueOnce({
      name: 'MessageRejected',
      message: 'Email address is not verified',
      $metadata: { httpStatusCode: 400 },
    });

    const result = await sendEmail(
      {
        to: 'recipient@example.com',
        subject: 'Service Restored',
        html: '<p>All systems normal</p>',
      },
      validConfig
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.errorCode).toBe('MessageRejected');
    expect(result.error).toBe('Email address is not verified');
  });
});
