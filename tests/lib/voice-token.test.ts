import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVoiceCallbackToken, verifyVoiceCallbackToken } from '@/lib/voice/token';

describe('voice callback token', () => {
  const previousSecret = process.env.VOICE_CALLBACK_SIGNING_SECRET;

  beforeEach(() => {
    process.env.VOICE_CALLBACK_SIGNING_SECRET = 'test-voice-signing-secret-at-least-32-characters';
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.VOICE_CALLBACK_SIGNING_SECRET;
    else process.env.VOICE_CALLBACK_SIGNING_SECRET = previousSecret;
  });

  it('binds the notification, user, incident, generation and purpose', () => {
    const before = Date.now();
    const token = createVoiceCallbackToken(
      {
        notificationId: 'notification-1',
        userId: 'user-1',
        incidentId: 'incident-1',
        escalationGeneration: 4,
      },
      60_000
    );
    const claims = verifyVoiceCallbackToken(token, before + 1);
    expect(claims).toMatchObject({
      notificationId: 'notification-1',
      userId: 'user-1',
      incidentId: 'incident-1',
      escalationGeneration: 4,
      purpose: 'voice-ack',
    });
    expect(claims?.nonce).toHaveLength(32);
  });

  it('rejects expired and tampered tokens', () => {
    const token = createVoiceCallbackToken(
      {
        notificationId: 'notification-1',
        userId: 'user-1',
        incidentId: 'incident-1',
        escalationGeneration: 1,
      },
      10
    );
    expect(verifyVoiceCallbackToken(token, Date.now() + 20)).toBeNull();
    expect(verifyVoiceCallbackToken(`${token.slice(0, -1)}x`)).toBeNull();
  });
});
