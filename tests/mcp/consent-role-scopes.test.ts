import { describe, expect, it } from 'vitest';
import { API_SCOPES, APP_ROLES } from '@/lib/authorization';
import { mcpScopesUsableByRole, partitionScopesForRole } from '@/lib/mcp/auth/role-scopes';
import { buildMcpConsentOffer, isMcpViewScope } from '@/lib/mcp/auth/consent-offer';
import { describeMcpScope, supportedMcpScopes } from '@/lib/mcp/auth/scopes';

const supported = [...supportedMcpScopes()].sort();
const usable = (role: (typeof APP_ROLES)[number]) =>
  supported.filter(scope => mcpScopesUsableByRole(role).has(scope));

describe('scopes a role can actually exercise', () => {
  it('offers an administrator every grantable scope but never admin:manage', () => {
    expect(usable('ADMIN')).toEqual(supported);
    expect(mcpScopesUsableByRole('ADMIN').has(API_SCOPES.ADMIN_MANAGE)).toBe(false);
  });

  it('offers a responder incident work and runbook runs, but no administration', () => {
    const responder = mcpScopesUsableByRole('RESPONDER');
    for (const scope of [
      'incidents:read',
      'incidents:write',
      'services:write',
      'schedules:write',
      'postmortems:write',
      'runbooks:read',
      'runbooks:execute',
      'runbooks:approve',
    ])
      expect(responder.has(scope), scope).toBe(true);
    for (const scope of [
      'runbooks:write',
      'runbooks:publish',
      'runbook-rules:write',
      'runbook-settings:write',
      'integrations:write',
      'integrations:delete',
      'escalation-policies:write',
      'status-pages:write',
      'custom-fields:write',
      'chatops:write',
      'response-policy:write',
      'audit:read',
    ])
      expect(responder.has(scope), scope).toBe(false);
    expect(usable('RESPONDER').length).toBeLessThan(supported.length);
  });

  it('gives the read-only auditor views only, apart from what its role already allows', () => {
    const changes = usable('AUDITOR').filter(scope => !isMcpViewScope(scope));
    // Both follow from the action policy: saved report views and SLO evaluation are read-level.
    expect(changes).toEqual(['reports:write', 'service-objectives:evaluate']);
    expect(mcpScopesUsableByRole('AUDITOR').has('audit:read')).toBe(true);
    expect(mcpScopesUsableByRole('AUDITOR').has('incidents:write')).toBe(false);
    expect(mcpScopesUsableByRole('AUDITOR').has('runbooks:execute')).toBe(false);
  });

  it('limits a team-scoped user to what its team capabilities reach', () => {
    const user = mcpScopesUsableByRole('USER');
    expect(user.has('incidents:read')).toBe(true);
    expect(user.has('services:read')).toBe(true);
    expect(user.has('incidents:write')).toBe(false);
    expect(user.has('audit:read')).toBe(false);
    expect(user.has('runbooks:read')).toBe(false);
  });

  it('derives from the authorization policy, so every usable scope is a mapped API scope', () => {
    const known = new Set<string>(Object.values(API_SCOPES));
    for (const role of APP_ROLES)
      for (const scope of mcpScopesUsableByRole(role)) expect(known.has(scope), scope).toBe(true);
  });

  it('partitions a request into offered and unavailable without reordering', () => {
    expect(
      partitionScopesForRole(['runbooks:write', 'incidents:read', 'audit:read'], 'RESPONDER')
    ).toEqual({ offered: ['incidents:read'], unavailable: ['runbooks:write', 'audit:read'] });
  });
});

describe('the consent offer', () => {
  it('groups by area, splits view from change and pre-selects only safe or named scopes', () => {
    const offer = buildMcpConsentOffer({
      scopes: [
        'incidents:read',
        'incidents:write',
        'services:read',
        'services:write',
        'runbooks:execute',
        'runbooks:write',
      ],
      explicitlyRequested: ['incidents:write'],
      role: 'RESPONDER',
    });
    expect(offer.unavailable).toEqual(['runbooks:write']);
    expect(offer.offered).not.toContain('runbooks:write');
    expect(offer.groups.map(group => group.label)).toEqual(['Incidents', 'Services', 'Runbooks']);
    const [incidents, services, runbooks] = offer.groups;
    expect(incidents.view).toEqual([
      { scope: 'incidents:read', label: 'View incidents', checked: true },
    ]);
    // Asked for by name: selected but still shown as a change.
    expect(incidents.change).toEqual([
      { scope: 'incidents:write', label: describeMcpScope('incidents:write'), checked: true },
    ]);
    // Not named: a change permission starts unselected.
    expect(services.change[0]).toMatchObject({ scope: 'services:write', checked: false });
    expect(runbooks.view).toEqual([]);
    expect(runbooks.change[0]).toMatchObject({ scope: 'runbooks:execute', checked: false });
  });

  it('offers nothing a role cannot use, even when the client ceiling allows it', () => {
    const offer = buildMcpConsentOffer({
      scopes: supported,
      explicitlyRequested: supported,
      role: 'AUDITOR',
    });
    expect(offer.offered).toEqual(usable('AUDITOR'));
    expect(offer.offered.length + offer.unavailable.length).toBe(supported.length);
    const shown = offer.groups.flatMap(group => [...group.view, ...group.change]);
    expect(shown.map(item => item.scope).sort()).toEqual([...offer.offered].sort());
  });

  it('puts every supported scope in a named area', () => {
    const offer = buildMcpConsentOffer({
      scopes: supported,
      explicitlyRequested: [],
      role: 'ADMIN',
    });
    expect(offer.groups.map(group => group.id)).not.toContain('other');
    expect(offer.groups.flatMap(group => group.view).every(item => item.checked)).toBe(true);
    expect(offer.groups.flatMap(group => group.change).some(item => item.checked)).toBe(false);
  });

  it('describes real scope names in plain language', () => {
    expect(describeMcpScope('status-pages:read')).toBe('View status pages');
    expect(describeMcpScope('escalation-policies:read')).toBe('View escalation policies');
    expect(describeMcpScope('runbooks:approve')).toBe('Approve runbooks waiting for review');
    expect(describeMcpScope('integrations:delete')).toBe('Delete integrations');
    expect(describeMcpScope('runbooks:execute')).toBe('Run runbooks after administrator approval');
  });
});
