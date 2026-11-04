import { describe, expect, it } from 'vitest';
import {
  evaluateOidcRoleClaims,
  oidcClaimSnapshot,
  readOidcClaim,
  resolveSignInRole,
  type OidcRoleRule,
} from '@/lib/oidc/role-mapping';

const legacyRules: OidcRoleRule[] = [
  { claim: 'groups', value: 'OpsKnight-Admins', role: 'ADMIN', caseSensitive: true },
];

describe('OIDC role mapping policy', () => {
  it('treats missing and unmatched claims as a default-role fallback and reports missing claims', () => {
    expect(evaluateOidcRoleClaims({}, legacyRules)).toMatchObject({
      outcome: 'UNMATCHED',
      role: 'USER',
      deny: false,
      missingClaims: ['groups'],
    });
    expect(evaluateOidcRoleClaims({ groups: ['other'] }, legacyRules)).toMatchObject({
      outcome: 'UNMATCHED',
      role: 'USER',
      missingClaims: [],
    });
  });

  it('reports group overage as incomplete instead of deciding a role', () => {
    expect(evaluateOidcRoleClaims({ _claim_names: { groups: 'src1' } }, legacyRules)).toMatchObject(
      { outcome: 'INCOMPLETE', deny: false }
    );
    expect(evaluateOidcRoleClaims({ hasgroups: true }, legacyRules)).toMatchObject({
      outcome: 'INCOMPLETE',
    });
    // Overage is irrelevant when no rule reads the groups claim.
    expect(
      evaluateOidcRoleClaims({ hasgroups: true, roles: ['Admin'] }, [
        { claim: 'roles', value: 'Admin', role: 'ADMIN' },
      ])
    ).toMatchObject({ outcome: 'MATCHED', role: 'ADMIN' });
  });

  it('maps a present array claim', () => {
    expect(evaluateOidcRoleClaims({ groups: ['OpsKnight-Admins'] }, legacyRules)).toMatchObject({
      outcome: 'MATCHED',
      role: 'ADMIN',
      matchedRule: legacyRules[0],
    });
  });

  it('keeps legacy rules case-sensitive and makes new rules case-insensitive and trimmed', () => {
    expect(evaluateOidcRoleClaims({ groups: ['opsknight-admins'] }, legacyRules).outcome).toBe(
      'UNMATCHED'
    );
    const rules: OidcRoleRule[] = [
      { claim: 'groups', value: ' OpsKnight-Admins ', role: 'ADMIN', caseSensitive: false },
    ];
    expect(evaluateOidcRoleClaims({ groups: ['opsknight-admins  '] }, rules)).toMatchObject({
      outcome: 'MATCHED',
      role: 'ADMIN',
    });
    // A rule saved before caseSensitive existed is case-sensitive.
    expect(
      evaluateOidcRoleClaims({ groups: ['opsknight-admins'] }, [
        { claim: 'groups', value: 'OpsKnight-Admins', role: 'ADMIN' },
      ]).outcome
    ).toBe('UNMATCHED');
  });

  it('reads nested and namespaced claims', () => {
    const claims = {
      realm_access: { roles: ['opsknight-admin'] },
      resource_access: { opsknight: { roles: ['responder'] } },
      'https://example.com/roles': ['auditor'],
    };
    expect(readOidcClaim(claims, 'realm_access.roles')).toEqual(['opsknight-admin']);
    expect(readOidcClaim(claims, 'resource_access.opsknight.roles')).toEqual(['responder']);
    expect(readOidcClaim(claims, 'https://example.com/roles')).toEqual(['auditor']);
    expect(readOidcClaim(claims, 'realm_access.missing')).toBeUndefined();
    expect(readOidcClaim(claims, 'constructor')).toBeUndefined();
    expect(
      evaluateOidcRoleClaims(claims, [
        { claim: 'realm_access.roles', value: 'opsknight-admin', role: 'ADMIN' },
      ]).role
    ).toBe('ADMIN');
  });

  it('applies highest-privilege or first-match precedence as configured', () => {
    const rules: OidcRoleRule[] = [
      { claim: 'groups', value: 'everyone-ops', role: 'USER', caseSensitive: false },
      { claim: 'groups', value: 'ops-admins', role: 'ADMIN', caseSensitive: false },
      { claim: 'groups', value: 'ops-responders', role: 'RESPONDER', caseSensitive: false },
    ];
    const claims = { groups: ['everyone-ops', 'ops-admins', 'ops-responders'] };
    expect(evaluateOidcRoleClaims(claims, rules, { rolePrecedence: 'HIGHEST_ROLE' }).role).toBe(
      'ADMIN'
    );
    expect(evaluateOidcRoleClaims(claims, rules, { rolePrecedence: 'FIRST_MATCH' }).role).toBe(
      'USER'
    );
  });

  it('uses the configured default role and deny policy only when rules exist', () => {
    expect(
      evaluateOidcRoleClaims({ groups: [] }, legacyRules, {
        defaultRole: 'RESPONDER',
        unmatchedPolicy: 'DENY',
      })
    ).toMatchObject({ outcome: 'UNMATCHED', role: 'RESPONDER', deny: true });
    expect(evaluateOidcRoleClaims({}, [], { unmatchedPolicy: 'DENY' }).deny).toBe(false);
  });
});

describe('resolving the role a person ends up with', () => {
  const matched = evaluateOidcRoleClaims({ groups: ['OpsKnight-Admins'] }, legacyRules);
  const unmatched = evaluateOidcRoleClaims({ groups: [] }, legacyRules);
  const incomplete = evaluateOidcRoleClaims({ hasgroups: true }, legacyRules);

  it('never overwrites a manually assigned role', () => {
    expect(resolveSignInRole(matched, { role: 'USER', roleSource: 'MANUAL' })).toEqual({
      role: 'USER',
      roleSource: 'MANUAL',
      changed: false,
    });
  });

  it('moves an existing account under directory control on its first link when a rule matches', () => {
    expect(
      resolveSignInRole(matched, { role: 'USER', roleSource: 'MANUAL' }, { firstLink: true })
    ).toEqual({ role: 'ADMIN', roleSource: 'OIDC', changed: true });
    expect(
      resolveSignInRole(unmatched, { role: 'RESPONDER', roleSource: 'MANUAL' }, { firstLink: true })
    ).toMatchObject({ role: 'RESPONDER', roleSource: 'MANUAL', changed: false });
  });

  it('applies rules to directory-managed accounts, including demotion', () => {
    expect(resolveSignInRole(unmatched, { role: 'ADMIN', roleSource: 'OIDC' })).toEqual({
      role: 'USER',
      roleSource: 'OIDC',
      changed: true,
    });
  });

  it('keeps the current role when claims are incomplete', () => {
    expect(resolveSignInRole(incomplete, { role: 'ADMIN', roleSource: 'OIDC' })).toEqual({
      role: 'ADMIN',
      roleSource: 'OIDC',
      changed: false,
    });
  });
});

describe('claim snapshots', () => {
  it('keeps only claims referenced by rules, bounded', () => {
    const snapshot = oidcClaimSnapshot(
      {
        email: 'a@example.com',
        groups: Array.from({ length: 500 }, (_, index) => `g${index}`),
        realm_access: { roles: ['admin'] },
      },
      [{ claim: 'groups' }, { claim: 'realm_access.roles' }, { claim: 'absent' }]
    );
    expect(Object.keys(snapshot ?? {})).toEqual(['groups', 'realm_access.roles']);
    expect(snapshot?.groups).toHaveLength(200);
    expect(JSON.stringify(snapshot)).not.toContain('a@example.com');
    expect(oidcClaimSnapshot({ email: 'x' }, [])).toBeNull();
  });
});
