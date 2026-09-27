import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateTwilioRequest } from '@/lib/twilio/signature';

describe('Twilio request signature', () => {
  it('validates sorted form parameters and rejects tampering', () => {
    const url = 'https://ops.example.com/api/webhooks/notifications/twilio/voice/status?id=1';
    const params = new URLSearchParams({ CallStatus: 'answered', CallSid: 'CA123' });
    const sorted = 'CallSidCA123CallStatusanswered';
    const signature = createHmac('sha1', 'secret').update(`${url}${sorted}`).digest('base64');
    expect(validateTwilioRequest(url, params, signature, 'secret')).toBe(true);
    params.set('CallStatus', 'failed');
    expect(validateTwilioRequest(url, params, signature, 'secret')).toBe(false);
  });
});
