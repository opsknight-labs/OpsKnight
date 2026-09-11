import { describe, expect, it } from 'vitest';
import { evaluateOidcRoleClaims } from '@/lib/oidc/role-mapping';

const rules = [{ claim: 'groups', value: 'OpsKnight-Admins', role: 'ADMIN' as const }];

describe('OIDC role mapping policy', () => {
  it('distinguishes missing claims from a present claim with no match', () => {
    expect(evaluateOidcRoleClaims({}, rules)).toEqual({
      ok: false,
      reason: 'OIDC_ROLE_CLAIM_MISSING',
    });
    expect(evaluateOidcRoleClaims({ groups: ['other'] }, rules)).toEqual({
      ok: true,
      role: 'USER',
      matched: false,
    });
  });

  it('fails closed for Entra group overage', () => {
    expect(evaluateOidcRoleClaims({ _claim_names: { groups: 'src1' } }, rules)).toEqual({
      ok: false,
      reason: 'OIDC_GROUPS_OVERAGE',
    });
    expect(evaluateOidcRoleClaims({ hasgroups: true }, rules)).toEqual({
      ok: false,
      reason: 'OIDC_GROUPS_OVERAGE',
    });
  });

  it('maps a present array claim', () => {
    expect(evaluateOidcRoleClaims({ groups: ['OpsKnight-Admins'] }, rules)).toEqual({
      ok: true,
      role: 'ADMIN',
      matched: true,
    });
  });
});
