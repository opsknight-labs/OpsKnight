import { describe, expect, it } from 'vitest';
import { evaluateOidcRoleClaims } from '@/lib/oidc/role-mapping';

const rules = [{ claim: 'groups', value: 'OpsKnight-Admins', role: 'ADMIN' as const }];

describe('OIDC role mapping policy', () => {
  it('treats missing and unmatched claims as a safe default-role fallback', () => {
    expect(evaluateOidcRoleClaims({}, rules)).toEqual({
      ok: true,
      role: 'USER',
      matched: false,
    });
    expect(evaluateOidcRoleClaims({ groups: ['other'] }, rules)).toEqual({
      ok: true,
      role: 'USER',
      matched: false,
    });
  });

  it('denies mapped elevation without denying authentication on group overage', () => {
    expect(evaluateOidcRoleClaims({ _claim_names: { groups: 'src1' } }, rules)).toEqual({
      ok: true,
      role: 'USER',
      matched: false,
      groupsOverage: true,
    });
    expect(evaluateOidcRoleClaims({ hasgroups: true }, rules)).toEqual({
      ok: true,
      role: 'USER',
      matched: false,
      groupsOverage: true,
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
