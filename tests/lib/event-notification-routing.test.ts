import { describe, expect, it } from 'vitest';
import { escalationNotificationRoute } from '@/lib/events';

describe('event escalation notification routing', () => {
  it.each([
    [{ escalated: true }, 'service'],
    [{ escalated: false, reason: 'Escalation scheduled' }, 'service'],
    [{ escalated: false, reason: 'Escalation already in progress' }, 'service'],
    [{ escalated: false, reason: 'No escalation policy configured' }, 'fallback'],
    [{ escalated: false, reason: 'No users to notify' }, 'fallback'],
    [{ escalated: false, reason: 'Invalid target configuration' }, 'fallback'],
  ] as const)('routes %j to %s notifications', (result, expected) => {
    expect(escalationNotificationRoute(result)).toBe(expected);
  });
});
