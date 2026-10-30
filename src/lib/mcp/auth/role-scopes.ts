import { API_SCOPES, type AppRole } from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  apiScopeForAction,
  authorize,
  type AuthorizationAction,
} from '@/lib/authorization-policy';

/**
 * Every API scope mapped to the authorization actions it unlocks, inverted from the product's own
 * action → scope contract (`apiScopeForAction`). A scope with no mapped action unlocks nothing.
 */
const ACTIONS_BY_SCOPE = (() => {
  const map = new Map<string, AuthorizationAction[]>();
  for (const action of Object.values(AUTHORIZATION_ACTIONS)) {
    const scope = apiScopeForAction(action);
    if (!scope) continue;
    map.set(scope, [...(map.get(scope) ?? []), action]);
  }
  return map;
})();

/**
 * The scopes a person with this role could actually exercise: a scope is usable when the role is
 * allowed at least one action that the scope gates, either globally or for resources in its teams.
 * `admin:manage` is never offered to an assistant.
 */
export function mcpScopesUsableByRole(role: AppRole): Set<string> {
  // The actor is synthetic and has no API key, so `authorize` only evaluates the role's capabilities.
  const actor = { id: 'mcp-consent', role, status: 'ACTIVE' as const, teamIds: [] };
  const usable = new Set<string>();
  for (const [scope, actions] of ACTIONS_BY_SCOPE) {
    if (scope === API_SCOPES.ADMIN_MANAGE) continue;
    if (actions.some(action => authorize({ actor, action }).allowed)) usable.add(scope);
  }
  return usable;
}

/** Splits requested scopes into those the role may grant and those it can never use. */
export function partitionScopesForRole(scopes: readonly string[], role: AppRole) {
  const usable = mcpScopesUsableByRole(role);
  return {
    offered: scopes.filter(scope => usable.has(scope)),
    unavailable: scopes.filter(scope => !usable.has(scope)),
  };
}
