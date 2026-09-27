import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getVoiceConfig: vi.fn(),
}));

vi.mock('twilio', () => ({
  default: vi.fn(() => ({ calls: { create: mocks.create } })),
}));
vi.mock('@/lib/notification-providers', () => ({
  getVoiceConfig: mocks.getVoiceConfig,
}));
vi.mock('@/lib/env-validation', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://ops.example.com'),
}));

import { sendVoiceCall } from '@/lib/voice/twilio';

describe('Twilio voice provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOICE_CALLBACK_SIGNING_SECRET = 'test-voice-signing-secret-at-least-32-characters';
    mocks.getVoiceConfig.mockResolvedValue({
      enabled: true,
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'secret',
      fromNumber: '+14155550100',
    });
  });

  it('creates an incident call with TwiML, DTMF and status callbacks', async () => {
    mocks.create.mockResolvedValue({ sid: 'CA123', status: 'queued' });
    const result = await sendVoiceCall({
      to: '+14155550101',
      from: '+14155550100',
      message: 'Critical incident for Payments',
      notificationId: 'notification-1',
      incidentId: 'incident-1',
      userId: 'user-1',
      escalationGeneration: 2,
      requireAck: true,
    });
    expect(result).toEqual(
      expect.objectContaining({ success: true, callSid: 'CA123', providerMessageId: 'CA123' })
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+14155550101',
        from: '+14155550100',
        twiml: expect.stringContaining('<Gather'),
        statusCallback: expect.stringContaining('notificationId=notification-1'),
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      })
    );
  });

  it('classifies invalid destinations as permanent failures', async () => {
    mocks.create.mockRejectedValue({ status: 400, code: 21211, message: 'Invalid phone number' });
    await expect(
      sendVoiceCall({
        to: '+100',
        from: '+14155550100',
        message: 'Test',
        notificationId: 'notification-1',
        requireAck: false,
      })
    ).resolves.toEqual(
      expect.objectContaining({ success: false, retryable: false, errorCode: '21211' })
    );
  });

  it('classifies provider throttling as retryable with backoff', async () => {
    mocks.create.mockRejectedValue({ status: 429, code: 20429, message: 'Too many requests' });
    await expect(
      sendVoiceCall({
        to: '+14155550101',
        from: '+14155550100',
        message: 'Test',
        notificationId: 'notification-1',
        requireAck: false,
      })
    ).resolves.toEqual(
      expect.objectContaining({ success: false, retryable: true, retryAfterMs: 60_000 })
    );
  });
});
