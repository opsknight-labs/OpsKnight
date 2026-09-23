import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSMS } from '@/lib/sms';
import * as notificationProviders from '@/lib/notification-providers';

const mockSnsSend = vi.fn();
class MockSNSClient {
  config: Record<string, unknown>;
  constructor(config: Record<string, unknown>) {
    this.config = config;
  }
  send = mockSnsSend;
}

class MockPublishCommand {
  input: unknown;
  constructor(input: unknown) {
    this.input = input;
  }
}

vi.mock('@aws-sdk/client-sns', () => ({
  default: {
    SNSClient: MockSNSClient,
    PublishCommand: MockPublishCommand,
  },
  SNSClient: MockSNSClient,
  PublishCommand: MockPublishCommand,
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

describe('AWS SNS SMS Provider Transport Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delivers SMS successfully via AWS SNS', async () => {
    vi.spyOn(notificationProviders, 'getSMSConfig').mockResolvedValue({
      provider: 'aws-sns',
      enabled: true,
      accessKeyId: 'test-aws-access-key-id',
      secretAccessKey: 'aws_secret_key_sns',
      region: 'us-east-1',
    });

    mockSnsSend.mockResolvedValueOnce({
      MessageId: 'sns-msg-id-555',
    });

    const result = await sendSMS({
      to: '+15551234567',
      message: 'AWS SNS alert: payment service degradation',
    });

    expect(result.success).toBe(true);
    expect(mockSnsSend).toHaveBeenCalled();
  });

  it('fails early when AWS credentials are not configured', async () => {
    vi.spyOn(notificationProviders, 'getSMSConfig').mockResolvedValue({
      provider: 'aws-sns',
      enabled: true,
      accessKeyId: '',
      secretAccessKey: '',
      region: 'us-east-1',
    });

    const result = await sendSMS({
      to: '+15551234567',
      message: 'AWS SNS alert',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('AWS SNS configuration incomplete');
    expect(mockSnsSend).not.toHaveBeenCalled();
  });

  it('handles invalid authentication errors from AWS SNS', async () => {
    vi.spyOn(notificationProviders, 'getSMSConfig').mockResolvedValue({
      provider: 'aws-sns',
      enabled: true,
      accessKeyId: 'INVALID_KEY',
      secretAccessKey: 'INVALID_SECRET',
      region: 'us-east-1',
    });

    mockSnsSend.mockRejectedValueOnce({
      name: 'InvalidClientTokenId',
      message: 'The security token included in the request is invalid.',
    });

    const result = await sendSMS({
      to: '+15551234567',
      message: 'AWS SNS alert',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('AWS authentication failed');
  });
});
