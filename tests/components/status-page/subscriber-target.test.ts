import { describe, expect, it } from 'vitest';
import { subscriberTarget } from '@/components/status-page/StatusPageSubscribers';

describe('subscriberTarget', () => {
  it('shows channel subscribers by channel, never the stored hash key', () => {
    expect(subscriberTarget('sms:+15551234567')).toEqual({
      label: 'SMS +15551234567',
      channel: 'sms',
    });
    expect(subscriberTarget('slack:ab12')).toEqual({ label: 'Slack webhook', channel: 'chat' });
    expect(subscriberTarget('teams:cd34').label).toBe('Microsoft Teams webhook');
    expect(subscriberTarget('a@example.com')).toEqual({ label: 'a@example.com', channel: 'email' });
  });
});
