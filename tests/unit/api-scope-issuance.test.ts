import { describe, expect, it } from 'vitest';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { ALL_API_SCOPE_DEFINITIONS, disallowedScopesForRole } from '@/lib/api-scope-registry';

const actor = (role: string, scopes: string[]) =>
  ({
    id: 'u',
    role,
    status: 'ACTIVE',
    teamIds: [],
    apiKey: { id: 'k', scopes },
  }) as AuthorizationActor;

// Scopes enforced outside AUTHORIZATION_ACTIONS (the /api/v1 response-policy API requires ADMIN).
const V1_ONLY = new Map<string, readonly string[]>([
  ['response-policy:read', ['ADMIN']],
  ['response-policy:write', ['ADMIN']],
]);

/** Actions whose policy is gated by exactly this scope. */
function actionsFor(scope: string) {
  return Object.values(AUTHORIZATION_ACTIONS).filter(action => {
    const without = authorize({ actor: actor('ADMIN', []), action });
    const withScope = authorize({ actor: actor('ADMIN', [scope]), action });
    return !without.allowed && without.reason === 'MISSING_SCOPE' && withScope.allowed;
  });
}

describe('API scope issuance matches what each role can use', () => {
  it('lets team owners mint usable team scopes without granting global team administration', () => {
    expect(disallowedScopesForRole('USER', ['teams:read', 'teams:write'])).toEqual([]);
    expect(disallowedScopesForRole('AUDITOR', ['teams:write'])).toEqual(['teams:write']);
    const user = actor('USER', ['teams:read', 'teams:write']);
    expect(authorize({ actor: user, action: AUTHORIZATION_ACTIONS.TEAM_MANAGE }).allowed).toBe(
      false
    );
    expect(
      authorize({
        actor: user,
        action: AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_MANAGE,
        resource: { type: 'team', teamId: 'owned-team', ownerIds: [user.id] },
      }).allowed
    ).toBe(true);
    expect(
      authorize({
        actor: user,
        action: AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_MANAGE,
        resource: { type: 'team', teamId: 'other-team', ownerIds: [] },
      }).allowed
    ).toBe(false);
  });
  const issuable = ALL_API_SCOPE_DEFINITIONS.filter(def => def.status === 'active').flatMap(def =>
    def.issuableBy.map(role => [role, def.scope] as const)
  );

  it.each(issuable)(
    '%s may only be issued %s if it grants at least one operation',
    (role, scope) => {
      const v1Roles = V1_ONLY.get(scope);
      if (v1Roles) {
        expect(v1Roles).toContain(role);
        return;
      }
      const actions = actionsFor(scope);
      expect(actions.length, `${scope} gates no authorization action`).toBeGreaterThan(0);
      const usable = actions.some(
        action => authorize({ actor: actor(role, [scope]), action }).allowed
      );
      expect(usable, `${role} would receive ${scope} but every operation it gates is denied`).toBe(
        true
      );
    }
  );
});
