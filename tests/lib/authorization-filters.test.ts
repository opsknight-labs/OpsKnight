import { describe, expect, it } from 'vitest';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getScheduleApiScope } from '@/lib/schedule-api-auth';

const user: AuthorizationActor = {
  id: 'user-1',
  role: 'USER',
  status: 'ACTIVE',
  teamIds: ['team-1'],
};

describe('authorization query filters', () => {
  it('generates incident scope from the same assignee, watcher, visibility, and team policy', () => {
    expect(incidentReadWhere(user)).toEqual({
      OR: [
        { assigneeId: 'user-1' },
        { watchers: { some: { userId: 'user-1' } } },
        {
          AND: [
            { visibility: 'PUBLIC' },
            {
              OR: [{ teamId: { in: ['team-1'] } }, { service: { teamId: { in: ['team-1'] } } }],
            },
          ],
        },
      ],
    });
  });

  it('returns global filters for global readers', () => {
    expect(incidentReadWhere({ ...user, role: 'AUDITOR', teamIds: [] })).toEqual({});
    expect(serviceReadWhere({ ...user, role: 'RESPONDER', teamIds: [] })).toEqual({});
  });

  it('fails closed when an API key lacks its required scope', () => {
    expect(() =>
      serviceReadWhere({ ...user, apiKey: { id: 'key-1', scopes: ['incidents:read'] } })
    ).toThrow('Forbidden. Service access denied.');
  });

  it('generates schedule scope from the normalized actor', () => {
    const apiUser = {
      ...user,
      apiKey: { id: 'key-1', scopes: ['schedules:read'] },
    };
    expect(getScheduleApiScope(apiUser)).toEqual({
      OR: [
        { layers: { some: { users: { some: { userId: 'user-1' } } } } },
        {
          escalationRules: {
            some: {
              policy: {
                services: {
                  some: { team: { members: { some: { userId: 'user-1' } } } },
                },
              },
            },
          },
        },
      ],
    });
  });
});
