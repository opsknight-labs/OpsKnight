import type { OidcClaims } from '@/lib/oidc/provider-policy';

export type OidcRole = 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER';
export type OidcRoleRule = { claim: string; value: string; role: OidcRole };
export type OidcRoleEvaluation =
  | { ok: true; role: OidcRole; matched: boolean }
  | { ok: false; reason: 'OIDC_ROLE_CLAIM_MISSING' | 'OIDC_GROUPS_OVERAGE' };

function hasGroupOverage(claims: OidcClaims): boolean {
  const names = claims._claim_names;
  return Boolean(
    (names && typeof names === 'object' && (names as Record<string, unknown>).groups != null) ||
    claims.hasgroups === true ||
    claims.hasgroups === 'true'
  );
}

export function evaluateOidcRoleClaims(
  claims: OidcClaims,
  rules: OidcRoleRule[],
  defaultRole: OidcRole = 'USER'
): OidcRoleEvaluation {
  if (rules.length === 0) return { ok: true, role: defaultRole, matched: false };
  const names = new Set(rules.map(rule => rule.claim));
  if (names.has('groups') && hasGroupOverage(claims)) {
    return { ok: false, reason: 'OIDC_GROUPS_OVERAGE' };
  }
  if (![...names].some(name => Object.prototype.hasOwnProperty.call(claims, name))) {
    return { ok: false, reason: 'OIDC_ROLE_CLAIM_MISSING' };
  }
  for (const rule of rules) {
    const value = claims[rule.claim];
    const matched = Array.isArray(value)
      ? value.some(item => typeof item === 'string' && item === rule.value)
      : typeof value === 'string' && value === rule.value;
    if (matched) return { ok: true, role: rule.role, matched: true };
  }
  return { ok: true, role: defaultRole, matched: false };
}
