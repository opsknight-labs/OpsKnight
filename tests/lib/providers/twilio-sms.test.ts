import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSMS, formatToE164 } from '@/lib/sms';
import * as notificationProviders from '@/lib/notification-providers';

const mockMessagesCreate = vi.fn();
vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  })),
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

describe('Twilio SMS Provider Transport Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delivers SMS successfully and returns messageSid', async () => {
    vi.spyOn(notificationProviders, 'getSMSConfig').mockResolvedValue({
      provider: 'twilio',
      enabled: true,
      accountSid: 'AC_twilio_test_sid',
      authToken: 'auth_token_secret',
      fromNumber: '+15551234567',
    });

    mockMessagesCreate.mockResolvedValueOnce({
      sid: 'SM_sms_message_id_123',
      status: 'queued',
    });

    const result = await sendSMS({
      to: '+15559876543',
      message: 'Critical incident triggered on Production DB',
      notificationId: 'notif-sms-test-1',
    });

    expect(result.success).toBe(true);
    expect(result.messageSid).toBe('SM_sms_message_id_123');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Critical incident triggered on Production DB',
        from: '+15551234567',
        to: '+15559876543',
      })
    );
  });

  it('validates and formats destination phone number to E.164', () => {
    expect(formatToE164('+1 (555) 234-5678')).toBe('+15552345678');
    expect(formatToE164('+44 (0) 7911 123456')).toBe('+447911123456');
    expect(formatToE164('invalid-phone')).toBe('');
  });

  it('rejects malformed or unparseable phone numbers early', async () => {
    vi.spyOn(notificationProviders, 'getSMSConfig').mockResolvedValue({
      provider: 'twilio',
      enabled: true,
      accountSid: 'AC_twilio_test_sid',
      authToken: 'auth_token_secret',
      fromNumber: '+15551234567',
    });

    const result = await sendSMS({
      to: '12345',
      message: 'Test message',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid phone number format');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('handles 429 and Twilio rate limit code 20429 with retryAfterMs', async () => {
    vi.spyOn(notificationProviders, 'getSMSConfig').mockResolvedValue({
      provider: 'twilio',
      enabled: true,
      accountSid: 'AC_twilio_test_sid',
      authToken: 'auth_token_secret',
      fromNumber: '+15551234567',
    });

    mockMessagesCreate.mockRejectedValueOnce({
      status: 429,
      code: 20429,
      message: 'Too Many Requests',
    });

    const result = await sendSMS({
      to: '+15559876543',
      message: 'Critical incident triggered',
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.errorCode).toBe('20429');
    expect(result.retryAfterMs).toBe(60_000);
  });

  it('fails early when Twilio SMS configuration is incomplete', async () => {
    vi.spyOn(notificationProviders, 'getSMSConfig').mockResolvedValue({
      provider: 'twilio',
      enabled: true,
      accountSid: '',
      authToken: '',
      fromNumber: '',
    });

    const result = await sendSMS({
      to: '+15559876543',
      message: 'Test message',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Twilio configuration incomplete');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
