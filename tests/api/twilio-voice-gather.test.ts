import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notificationFindFirst: vi.fn(),
  notificationUpdateMany: vi.fn(),
  feedbackCreate: vi.fn(),
  feedbackDeleteMany: vi.fn(),
  attemptUpdateMany: vi.fn(),
  incidentFindUnique: vi.fn(),
  executeLifecycle: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      findFirst: mocks.notificationFindFirst,
      updateMany: mocks.notificationUpdateMany,
    },
    notificationProviderFeedback: {
      create: mocks.feedbackCreate,
      deleteMany: mocks.feedbackDeleteMany,
    },
    notificationDeliveryAttempt: { updateMany: mocks.attemptUpdateMany },
    incident: { findUnique: mocks.incidentFindUnique },
  },
}));
vi.mock('@/lib/notification-providers', () => ({
  getVoiceConfig: vi.fn().mockResolvedValue({ authToken: 'twilio-secret' }),
  getTwilioVoiceCallbackCredentials: vi.fn().mockResolvedValue({ authToken: 'twilio-secret' }),
}));
vi.mock('@/lib/app-url', () => ({
  getAppUrl: vi.fn().mockResolvedValue('https://ops.example.com'),
}));
vi.mock('@/lib/incidents/lifecycle', () => ({
  executeIncidentLifecycleCommand: mocks.executeLifecycle,
}));

import { POST } from '@/app/api/webhooks/notifications/twilio/voice/gather/route';
import { createVoiceCallbackToken } from '@/lib/voice/token';

function requestFor(token: string, body: string, signatureOverride?: string) {
  const url = `https://ops.example.com/api/webhooks/notifications/twilio/voice/gather?token=${encodeURIComponent(token)}`;
  const params = new URLSearchParams(body);
  const sorted = Array.from(params.keys())
    .sort()
    .map(key => `${key}${params.get(key) || ''}`)
    .join('');
  const signature = createHmac('sha1', 'twilio-secret').update(`${url}${sorted}`).digest('base64');
  return new NextRequest(url, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signatureOverride ?? signature,
    },
  });
}

describe('Twilio voice DTMF acknowledgement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VOICE_CALLBACK_SIGNING_SECRET = 'test-voice-signing-secret-at-least-32-characters';
    mocks.notificationFindFirst.mockResolvedValue({
      id: 'notification-1',
      user: { id: 'user-1', name: 'Jane' },
      incident: { status: 'OPEN', escalationGeneration: 3 },
    });
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.feedbackCreate.mockResolvedValue({ id: 'feedback-1' });
    mocks.executeLifecycle.mockResolvedValue({ status: 'ACKNOWLEDGED', changed: true });
    mocks.attemptUpdateMany.mockResolvedValue({ count: 1 });
  });

  function token() {
    return createVoiceCallbackToken({
      notificationId: 'notification-1',
      userId: 'user-1',
      incidentId: 'incident-1',
      escalationGeneration: 3,
    });
  }

  it('uses the canonical lifecycle command after both signatures and identities validate', async () => {
    const response = await POST(requestFor(token(), 'CallSid=CA123&Digits=1'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('incident has been acknowledged');
    expect(mocks.executeLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'incident-1',
        command: 'ACKNOWLEDGE',
        source: 'VOICE',
        expectedStatus: 'OPEN',
        actor: { id: 'user-1', name: 'Jane' },
      })
    );
    expect(mocks.attemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'ACKNOWLEDGED' }) })
    );
  });

  it('rejects an invalid Twilio signature before reading notification state', async () => {
    const response = await POST(requestFor(token(), 'CallSid=CA123&Digits=1', 'invalid'));
    expect(response.status).toBe(401);
    expect(mocks.notificationFindFirst).not.toHaveBeenCalled();
    expect(mocks.executeLifecycle).not.toHaveBeenCalled();
  });

  it('does not acknowledge a superseded escalation generation', async () => {
    mocks.notificationFindFirst.mockResolvedValue({
      id: 'notification-1',
      user: { id: 'user-1', name: 'Jane' },
      incident: { status: 'OPEN', escalationGeneration: 4 },
    });
    const response = await POST(requestFor(token(), 'CallSid=CA123&Digits=1'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('earlier escalation');
    expect(mocks.executeLifecycle).not.toHaveBeenCalled();
  });

  it('ignores digits other than one', async () => {
    const response = await POST(requestFor(token(), 'CallSid=CA123&Digits=2'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('No acknowledgement');
    expect(mocks.executeLifecycle).not.toHaveBeenCalled();
  });
});
