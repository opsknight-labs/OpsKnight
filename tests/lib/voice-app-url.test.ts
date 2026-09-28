import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCall: vi.fn(),
  getAppUrl: vi.fn(),
  getVoiceConfig: vi.fn(),
}));

vi.mock('@/lib/app-url', () => ({
  getAppUrl: mocks.getAppUrl,
}));

vi.mock('@/lib/notification-providers', () => ({
  getVoiceConfig: mocks.getVoiceConfig,
}));

vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    calls: {
      create: mocks.createCall,
    },
  })),
}));

import { sendVoiceCall } from '@/lib/voice/twilio';

describe('Voice URL resolution via canonical getAppUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOICE_CALLBACK_SIGNING_SECRET = 'test-voice-signing-secret-at-least-32-characters';
    mocks.getVoiceConfig.mockResolvedValue({
      enabled: true,
      provider: 'twilio',
      accountSid: 'FAKE_SID_TEST',
      authToken: 'test-token',
      fromNumber: '+14155550100',
    });
    mocks.createCall.mockResolvedValue({
      sid: 'CA_TEST_123',
      status: 'queued',
    });
  });

  it('uses DB-backed SystemSettings.appUrl for Twilio callback URLs instead of env-only fallback', async () => {
    // Database returns canonical URL (e.g. from SystemSettings.appUrl)
    mocks.getAppUrl.mockResolvedValue('https://ops.mycompany.internal');

    const result = await sendVoiceCall({
      to: '+14155550199',
      from: '+14155550100',
      message: 'Test incident message',
      notificationId: 'notif-123',
      deliveryAttemptId: 'attempt-456',
      requireAck: true,
      incidentId: 'inc-789',
      userId: 'usr-101',
      escalationGeneration: 1,
    });

    expect(result.success).toBe(true);
    expect(mocks.createCall).toHaveBeenCalledTimes(1);

    const callArgs = mocks.createCall.mock.calls[0][0];

    // Status callback must use the canonical app URL
    expect(callArgs.statusCallback).toContain(
      'https://ops.mycompany.internal/api/webhooks/notifications/twilio/voice/status'
    );
    expect(callArgs.statusCallback).toContain('notificationId=notif-123');
    expect(callArgs.statusCallback).toContain('attemptId=attempt-456');

    // TwiML gatherUrl must also use the canonical app URL
    expect(callArgs.twiml).toContain(
      'https://ops.mycompany.internal/api/webhooks/notifications/twilio/voice/gather'
    );
  });

  it('generates a minimized token that does NOT include userId or incidentId in query string', async () => {
    mocks.getAppUrl.mockResolvedValue('https://ops.mycompany.internal');

    await sendVoiceCall({
      to: '+14155550199',
      from: '+14155550100',
      message: 'Test incident message',
      notificationId: 'notif-123',
      deliveryAttemptId: 'attempt-456',
      requireAck: true,
      incidentId: 'sensitive-incident-uuid-999',
      userId: 'sensitive-user-uuid-888',
      escalationGeneration: 1,
    });

    const callArgs = mocks.createCall.mock.calls[0][0];
    const twiml = callArgs.twiml as string;

    // The TwiML should NOT contain the sensitive UUIDs in the gather action URL
    expect(twiml).not.toContain('sensitive-incident-uuid-999');
    expect(twiml).not.toContain('sensitive-user-uuid-888');
  });
});
