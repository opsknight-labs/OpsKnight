import { describe, expect, it } from 'vitest';
import {
  actionItemReadWhere,
  actorMetricReadScope,
  incidentReadWhere,
  postmortemReadWhere,
  scheduleReadWhere,
  serviceReadWhere,
  teamReadWhere,
} from '@/lib/authorization-filters';
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

  it('scopes every related directory through the same actor policy', () => {
    expect(serviceReadWhere(user)).toEqual({ teamId: { in: ['team-1'] } });
    expect(teamReadWhere(user)).toEqual({ id: { in: ['team-1'] } });
    expect(actionItemReadWhere(user)).toEqual({ incident: incidentReadWhere(user) });
    expect(postmortemReadWhere(user)).toEqual({ incident: incidentReadWhere(user) });
    expect(scheduleReadWhere(user)).toMatchObject({
      OR: expect.arrayContaining([
        { layers: { some: { users: { some: { userId: 'user-1' } } } } },
        { overrides: { some: { OR: [{ userId: 'user-1' }, { replacesUserId: 'user-1' }] } } },
      ]),
    });
  });

  it('creates an explicit metrics authorization scope for scoped readers', () => {
    expect(actorMetricReadScope(user)).toEqual({
      authorizationScope: { actorId: 'user-1', teamIds: ['team-1'] },
    });
    expect(actorMetricReadScope({ ...user, role: 'ADMIN' })).toEqual({});
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
          overrides: {
            some: { OR: [{ userId: 'user-1' }, { replacesUserId: 'user-1' }] },
          },
        },
        {
          escalationRules: {
            some: {
              policy: {
                services: {
                  some: {
                    team: { members: { some: { userId: 'user-1', role: 'OWNER' } } },
                  },
                },
              },
            },
          },
        },
      ],
    });
  });
});
