import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { stepUpScopes } from '@/lib/mcp/auth/step-up';
import { mcpScopesUsableByRole } from '@/lib/mcp/auth/role-scopes';
import { MCP_CATALOG, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import { APP_ROLES } from '@/lib/authorization';
import { authorizationActorFromUser } from '@/lib/authorization-actors';

const actor = (role: string, scopes: string[], teamIds: string[] = []) => ({
  ...authorizationActorFromUser({
    id: 'u1',
    role,
    status: 'ACTIVE',
    teamMemberships: teamIds.map(teamId => ({ teamId })),
  })!,
  apiKey: { id: 'mcp:g1', scopes },
});
const open = {
  writesEnabled: true,
  sensitiveReadsEnabled: true,
  disabledCapabilities: [] as string[],
};
const call = (operationId: string, clientScopes: readonly string[], policy = open) => ({
  clientScopes,
  policy,
  method: 'tools/call',
  params: { name: 'call_operation', arguments: { operationId } },
});
const everyScope = [...new Set(MCP_CATALOG.flatMap(operation => operation.requiredScopes))];

describe('stepUpScopes', () => {
  it('only ever asks for scopes the consent page will offer that role, so it cannot loop', () => {
    // A challenge the consent page cannot satisfy would send the assistant round in circles:
    // 403, sign-in, the same grant, 403 again.
    let challenged = 0;
    for (const role of APP_ROLES) {
      const offered = mcpScopesUsableByRole(role);
      for (const teamIds of [[], ['team-1']])
        for (const operation of MCP_CATALOG) {
          if (!(isMcpExecutable(operation) || isMcpApprovalGated(operation))) continue;
          const scopes = stepUpScopes(
            actor(role, [], teamIds),
            call(operation.operationId, everyScope)
          );
          if (!scopes) continue;
          challenged += 1;
          for (const scope of scopes)
            expect([role, scope, offered.has(scope)]).toEqual([role, scope, true]);
        }
    }
    expect(challenged).toBeGreaterThan(0);
  });

  it('keeps what the connection has and adds only what the call is missing', () => {
    expect(
      stepUpScopes(
        actor('ADMIN', ['services:read']),
        call('getIncident', ['services:read', 'incidents:read'])
      )
    ).toEqual(['services:read', 'incidents:read']);
  });

  it('never challenges for what the role, the ceiling or a policy switch would refuse anyway', () => {
    const ceiling = everyScope;
    // The role cannot do it: reconnecting would not help.
    expect(stepUpScopes(actor('AUDITOR', []), call('createIncident', ceiling))).toBeNull();
    // The assistant's ceiling lacks the scope.
    expect(stepUpScopes(actor('ADMIN', []), call('getIncident', ['services:read']))).toBeNull();
    // Changes off, or the capability disabled.
    expect(
      stepUpScopes(
        actor('ADMIN', []),
        call('createIncident', ceiling, { ...open, writesEnabled: false })
      )
    ).toBeNull();
    expect(
      stepUpScopes(
        actor('ADMIN', []),
        call('getIncident', ceiling, { ...open, disabledCapabilities: ['getIncident'] })
      )
    ).toBeNull();
    // Already granted, an unknown tool, or not a tool call at all.
    expect(
      stepUpScopes(actor('ADMIN', ['incidents:read']), call('getIncident', ceiling))
    ).toBeNull();
    expect(
      stepUpScopes(actor('ADMIN', []), { ...call('getIncident', ceiling), params: { name: 'x' } })
    ).toBeNull();
    expect(
      stepUpScopes(actor('ADMIN', []), { ...call('getIncident', ceiling), method: 'tools/list' })
    ).toBeNull();
  });
});
