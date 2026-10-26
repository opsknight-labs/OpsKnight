import { describe, expect, it } from 'vitest';
import { viewAllHref } from '@/components/dashboard/live/LiveIncidentsPanel';
import { DEFAULT_LIVE_QUERY, type LiveIncidentQuery } from '@/lib/dashboard/live-incidents-shared';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';

describe('dashboard navigation and capability contract', () => {
  const currentUserId = 'usr-responder-99';

  it('preserves Mine scope when navigating to the full incident list', () => {
    const mineScopeQuery: LiveIncidentQuery = {
      ...DEFAULT_LIVE_QUERY,
      scope: 'mine',
      view: 'active',
    };
    const href = viewAllHref(mineScopeQuery, currentUserId);
    expect(href).toContain('assignee=usr-responder-99');
    expect(href).toContain('filter=all_open');
  });

  it('preserves My Teams scope when navigating to the full incident list', () => {
    const myTeamsScopeQuery: LiveIncidentQuery = {
      ...DEFAULT_LIVE_QUERY,
      scope: 'teams',
      view: 'active',
    };
    const href = viewAllHref(myTeamsScopeQuery, currentUserId);
    expect(href).toContain('teamId=mine');
    expect(href).toContain('filter=all_open');
  });

  it('preserves specific team and Mine scope when filtered', () => {
    const filteredQuery: LiveIncidentQuery = {
      ...DEFAULT_LIVE_QUERY,
      scope: 'mine',
      teamId: 'team-infra',
    };
    const href = viewAllHref(filteredQuery, currentUserId);
    expect(href).toContain('assignee=usr-responder-99');
    expect(href).toContain('teamId=team-infra');
  });

  it('preserves Mine scope on critical focus view', () => {
    const criticalQuery: LiveIncidentQuery = {
      ...DEFAULT_LIVE_QUERY,
      scope: 'mine',
      view: 'critical',
    };
    const href = viewAllHref(criticalQuery, currentUserId);
    expect(href).toContain('filter=critical_focus');
    expect(href).toContain('assignee=usr-responder-99');
  });

  it('does not inject user-specific scope when scope is all', () => {
    const allQuery: LiveIncidentQuery = {
      ...DEFAULT_LIVE_QUERY,
      scope: 'all',
      view: 'active',
    };
    const href = viewAllHref(allQuery, currentUserId);
    expect(href).toBe('/incidents?filter=all_open');
    expect(href).not.toContain('assignee=');
    expect(href).not.toContain('teamId=');
  });

  it('permits responders and admins to acknowledge incidents while restricting auditors and users', () => {
    const canAck = (role: 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER') =>
      hasCapability(role, CAPABILITIES.OPERATIONS_MANAGE) ||
      hasCapability(role, CAPABILITIES.INCIDENT_ACKNOWLEDGE_SCOPED);

    expect(canAck('ADMIN')).toBe(true);
    expect(canAck('RESPONDER')).toBe(true);
    expect(canAck('AUDITOR')).toBe(false);
    expect(canAck('USER')).toBe(false);
  });
});
