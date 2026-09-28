import { describe, expect, it } from 'vitest';
import { buildVoiceTwiml, voiceCallbackTwiml } from '@/lib/voice/twiml';
import { buildIncidentVoiceMessage } from '@/lib/voice/message';
import { buildNotificationEnvelope, encodeNotificationEnvelope } from '@/lib/notification-payload';

describe('voice TwiML', () => {
  it('speaks a concise message and gathers one DTMF digit', () => {
    const xml = buildVoiceTwiml({
      message: 'Critical incident for Payments & Checkout',
      gatherUrl: 'https://ops.example.com/gather?token=a&b=c',
      requireAck: true,
    });
    expect(xml).toContain('<Gather');
    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain('method="POST"');
    expect(xml).toContain('Press 1 to acknowledge');
    expect(xml).toContain('Payments &amp; Checkout');
    expect(xml).toContain('token=a&amp;b=c');
    expect(xml).toContain('<Hangup/>');
  });

  it('does not gather input for a synthetic test call', () => {
    const xml = buildVoiceTwiml({ message: 'OpsKnight test', requireAck: false });
    expect(xml).not.toContain('<Gather');
    expect(xml).toContain('<Say>OpsKnight test</Say>');
  });

  it('escapes callback speech', () => {
    expect(voiceCallbackTwiml('Already <resolved> & closed')).toContain(
      'Already &lt;resolved&gt; &amp; closed'
    );
  });

  it('renders incident urgency, service and title from the immutable snapshot', () => {
    const durable = encodeNotificationEnvelope(
      buildNotificationEnvelope(
        {
          id: 'incident-1',
          title: 'API latency above five seconds',
          urgency: 'HIGH',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          service: { id: 'service-1', name: 'Payments API' },
        },
        'triggered',
        new Date('2026-01-01T00:00:00Z'),
        'Page primary responder'
      )
    );
    expect(buildIncidentVoiceMessage(durable)).toBe(
      'high priority incident. Service: Payments API. Incident: API latency above five seconds.'
    );
  });
});
