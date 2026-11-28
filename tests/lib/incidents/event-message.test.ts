import { describe, expect, it } from 'vitest';
import { clipEventMessage, MAX_EVENT_MESSAGE_BYTES } from '@/lib/incidents/event-message';

describe('clipEventMessage', () => {
  it('leaves a message inside the byte budget alone', () => {
    expect(clipEventMessage('Incident acknowledged')).toBe('Incident acknowledged');
  });

  it('clips by UTF-8 bytes, not characters, and never splits a character', () => {
    const clipped = clipEventMessage('é'.repeat(5_000));
    expect(Buffer.byteLength(clipped, 'utf8')).toBeLessThanOrEqual(MAX_EVENT_MESSAGE_BYTES);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped).not.toContain('�');
  });
});
