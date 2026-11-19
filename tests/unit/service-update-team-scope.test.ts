import { describe, expect, it } from 'vitest';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';

const responder = { id: 'u1', role: 'RESPONDER', status: 'ACTIVE', teamIds: ['team-a'] } as const;
const update = (
  teamId: string | null,
  actor: Parameters<typeof authorize>[0]['actor'] = responder
) =>
  authorize({
    actor,
    action: AUTHORIZATION_ACTIONS.SERVICE_UPDATE,
    resource: { type: 'service', teamId },
  });

describe('SERVICE_UPDATE is team scoped like the UI', () => {
  it('lets a responder update only their own team services', () => {
    expect(update('team-a')).toEqual({ allowed: true, scope: 'resource' });
    expect(update('team-b').allowed).toBe(false);
    expect(update(null).allowed).toBe(false);
  });

  it('keeps admins global', () => {
    const decision = update('team-b', { id: 'a', role: 'ADMIN', status: 'ACTIVE', teamIds: [] });
    expect(decision.allowed && decision.scope).toBe('global');
  });
});
