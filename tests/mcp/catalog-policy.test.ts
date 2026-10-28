import { describe, expect, it } from 'vitest';
import { declaredRouteActions } from '../../scripts/mcp/route-policy';
import { MCP_OPERATION_MAP } from '@/lib/mcp/catalog';
import { canDiscover } from '@/lib/mcp/core/execution';

describe('canonical MCP route policy projection', () => {
  it('ignores advisory authorize probes and data properties named action', () => {
    const source = `export const GET = withV2Observability(async () => {
      enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
      const hints = [{action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE}];
      return authorize({actor, action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE});
    });`;
    expect(declaredRouteActions(source, 'GET')).toEqual(['incident.read']);
  });
  it('extracts a declarative endpoint gate and its mandatory domain checks', () => {
    const source = `export const POST = defineV2Route({action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
      handler: async () => { enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ); }});`;
    expect(declaredRouteActions(source, 'POST')).toEqual(['incident.read', 'runbook.execute']);
  });
  it('requires every scope of a joined projection and retains read-only action discovery', () => {
    const health = MCP_OPERATION_MAP.get('getServiceHealthSummary')!;
    const actor = {
      id: 'user',
      role: 'ADMIN' as const,
      status: 'ACTIVE' as const,
      teamIds: [],
      apiKey: { id: 'grant', scopes: ['services:read'] },
    };
    expect(canDiscover(actor, health)).toBe(false);
    expect(
      canDiscover({ ...actor, apiKey: { id: 'grant', scopes: health.requiredScopes } }, health)
    ).toBe(true);
    const advisory = MCP_OPERATION_MAP.get('getIncidentAvailableActions')!;
    expect(
      canDiscover(
        { ...actor, role: 'USER', apiKey: { id: 'grant', scopes: ['incidents:read'] } },
        advisory
      )
    ).toBe(true);
  });
});
