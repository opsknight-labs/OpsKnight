import { describe, expect, it } from 'vitest';
import {
  dashboardMetricsScope,
  dashboardUserReadWhere,
} from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { buildWidgetActivityIncidentWhere } from '@/lib/widget-data-provider';

const user: AuthorizationActor = {
  id: 'user-1',
  role: 'USER',
  status: 'ACTIVE',
  teamIds: ['team-1'],
};

describe('dashboard authorization filters', () => {
  it('limits regular-user metric calculations to their teams', () => {
    expect(dashboardMetricsScope(user)).toEqual({ teamId: ['team-1'], useOrScope: true });
  });

  it('limits the dashboard user picker to self and teammates', () => {
    expect(dashboardUserReadWhere(user)).toEqual({
      OR: [
        { id: 'user-1' },
        { teamMemberships: { some: { teamId: { in: ['team-1'] } } } },
      ],
    });
  });

  it('preserves organization-wide dashboard visibility for responders', () => {
    const responder: AuthorizationActor = {
      id: 'responder-1',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamIds: [],
    };

    expect(dashboardMetricsScope(responder)).toEqual({});
    expect(dashboardUserReadWhere(responder)).toEqual({});
  });

  it('intersects a requested service with the caller team scope for widget activity', () => {
    expect(
      buildWidgetActivityIncidentWhere({
        serviceId: 'service-outside-team',
        teamId: ['team-1'],
        useOrScope: true,
      })
    ).toEqual({
      AND: [
        { serviceId: 'service-outside-team' },
        {
          OR: [
            { teamId: { in: ['team-1'] } },
            { service: { teamId: { in: ['team-1'] } } },
          ],
        },
      ],
    });
  });
});
