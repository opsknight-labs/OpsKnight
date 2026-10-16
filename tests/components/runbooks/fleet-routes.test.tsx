import { describe, expect, it } from 'vitest';
import {
  fleetHref,
  isFleetSectionActive,
  legacyFleetRedirect,
} from '@/components/runbooks/agents/fleet-routes';
import { buildAgentWhere } from '@/components/runbooks/agents/agent-query';

describe('legacy /runbooks/agents?tab= redirects', () => {
  it('maps each legacy tab to its sub-route with page-local params', () => {
    expect(legacyFleetRedirect({ tab: 'pools', page: '2', poolId: 'cpool', memberPage: '3' })).toBe(
      '/runbooks/agents/pools?page=2&pool=cpool&memberPage=3'
    );
    expect(
      legacyFleetRedirect({ tab: 'secrets', page: '4', secretId: 'csecret', grantPage: '2' })
    ).toBe('/runbooks/agents/secrets?page=4&secret=csecret&grantPage=2');
    expect(legacyFleetRedirect({ tab: 'security', page: '9', q: 'x' })).toBe(
      '/runbooks/agents/security'
    );
  });

  it('does not redirect the agents tab, unknown tabs or prototype keys', () => {
    expect(legacyFleetRedirect({})).toBeNull();
    expect(legacyFleetRedirect({ tab: 'agents', q: 'web' })).toBeNull();
    expect(legacyFleetRedirect({ tab: 'constructor' })).toBeNull();
    expect(legacyFleetRedirect({ tab: 'https://evil.example' })).toBeNull();
  });

  it('drops unrelated params and encodes values', () => {
    expect(
      legacyFleetRedirect({ tab: ['pools', 'secrets'], poolId: 'a&b=c', status: 'OFFLINE' })
    ).toBe('/runbooks/agents/pools?pool=a%26b%3Dc');
  });
});

describe('fleet section routing', () => {
  it('builds hrefs without empty params', () => {
    expect(fleetHref('/runbooks/agents/pools', { page: 1, pool: undefined, memberPage: '' })).toBe(
      '/runbooks/agents/pools?page=1'
    );
    expect(fleetHref('/runbooks/agents/pools', {})).toBe('/runbooks/agents/pools');
  });

  it('marks exactly one section active, keeping Agent detail routes under Agents', () => {
    expect(isFleetSectionActive('/runbooks/agents', 'agents')).toBe(true);
    expect(isFleetSectionActive('/runbooks/agents/cagent123/setup', 'agents')).toBe(true);
    expect(isFleetSectionActive('/runbooks/agents/pools', 'agents')).toBe(false);
    expect(isFleetSectionActive('/runbooks/agents/pools', 'pools')).toBe(true);
    expect(isFleetSectionActive('/runbooks/agents/secrets', 'secrets')).toBe(true);
    expect(isFleetSectionActive('/runbooks/agents/security', 'secrets')).toBe(false);
    expect(isFleetSectionActive('/runbooks/agentsx', 'agents')).toBe(false);
  });
});

describe('buildAgentWhere', () => {
  const since = new Date('2026-01-01T00:00:00Z');

  it('hides revoked Agents by default', () => {
    expect(buildAgentWhere({}, since)).toEqual({ AND: [{ status: { not: 'REVOKED' } }] });
  });

  it('treats stale ONLINE/DEGRADED heartbeats as OFFLINE', () => {
    const where = buildAgentWhere({ status: 'OFFLINE' }, since);
    expect(JSON.stringify(where)).toContain('"lastHeartbeatAt":{"lt"');
    expect(buildAgentWhere({ status: 'ONLINE' }, since)).toEqual({
      AND: [{ status: 'ONLINE', lastHeartbeatAt: { gte: since } }],
    });
  });

  it('combines attention, pool and label filters', () => {
    const where = buildAgentWhere(
      { attention: true, poolId: 'cpool', labels: { env: 'prod' } },
      since
    ) as { AND: unknown[] };
    expect(where.AND).toHaveLength(3);
    expect(where.AND).toContainEqual({ poolMemberships: { some: { poolId: 'cpool' } } });
    expect(where.AND).toContainEqual({ labels: { path: ['env'], equals: 'prod' } });
  });
});
