import type { OidcClaims } from '@/lib/oidc/provider-policy';

export type OidcRole = 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER';
export type OidcRoleRule = {
  claim: string;
  value: string;
  role: OidcRole;
  /** Absent means case-sensitive: that is how rules saved before v2.2 behaved. */
  caseSensitive?: boolean;
};
export type OidcRolePolicy = {
  defaultRole?: OidcRole;
  unmatchedPolicy?: 'DEFAULT_ROLE' | 'DENY';
  rolePrecedence?: 'FIRST_MATCH' | 'HIGHEST_ROLE';
};

/**
 * - MATCHED: a rule matched; `role` is the role it grants.
 * - UNMATCHED: claims were complete and no rule matched; `role` is the default role, and
 *   `deny` says whether the workspace refuses unmatched people instead.
 * - INCOMPLETE: the provider said its group list was truncated (Entra "group overage"), so no
 *   decision can be made from it. Callers keep the person's current role.
 */
export type OidcRoleEvaluation = {
  outcome: 'MATCHED' | 'UNMATCHED' | 'INCOMPLETE';
  role: OidcRole;
  matchedRule: OidcRoleRule | null;
  deny: boolean;
  /** Rule claims that were not present in the sign-in at all. */
  missingClaims: string[];
};

export const OIDC_ROLE_RANK: Record<OidcRole, number> = {
  USER: 0,
  AUDITOR: 1,
  RESPONDER: 2,
  ADMIN: 3,
};

/**
 * Reads a claim by exact name first (namespaced claims such as "https://example.com/roles"
 * contain dots), then as a dotted path into nested objects (Keycloak "realm_access.roles").
 */
export function readOidcClaim(claims: OidcClaims, path: string): unknown {
  const whole = ownValue(claims, path);
  if (whole.found) return whole.value;
  let current: unknown = claims;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    const next = ownValue(current as Record<string, unknown>, key);
    if (!next.found) return undefined;
    current = next.value;
  }
  return current;
}

/** Own properties only, so names such as "constructor" never reach the prototype. */
function ownValue(object: Record<string, unknown>, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor ? { found: true as const, value: descriptor.value as unknown } : { found: false as const };
}

/** The string values a claim holds, whether it is a single value or a list. */
export function oidcClaimValues(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items
    .filter(item => typeof item === 'string' || typeof item === 'number')
    .map(item => String(item).trim())
    .filter(Boolean);
}

export function oidcRuleMatches(
  claims: OidcClaims,
  rule: { claim: string; value: string; caseSensitive?: boolean }
): boolean {
  const expected = rule.value.trim();
  const caseSensitive = rule.caseSensitive !== false;
  return oidcClaimValues(readOidcClaim(claims, rule.claim)).some(value =>
    caseSensitive ? value === expected : value.toLowerCase() === expected.toLowerCase()
  );
}

/** Microsoft Entra replaces the groups list with a pointer when a user has too many groups. */
export function hasGroupOverage(claims: OidcClaims): boolean {
  const names = claims._claim_names;
  return Boolean(
    (names && typeof names === 'object' && (names as Record<string, unknown>).groups != null) ||
    claims.hasgroups === true ||
    claims.hasgroups === 'true'
  );
}

function usesGroupsClaim(rules: Array<{ claim: string }>) {
  return rules.some(rule => rule.claim.trim().toLowerCase() === 'groups');
}

export function evaluateOidcRoleClaims(
  claims: OidcClaims,
  rules: OidcRoleRule[],
  policy: OidcRolePolicy = {}
): OidcRoleEvaluation {
  const defaultRole = policy.defaultRole ?? 'USER';
  const precedence = policy.rolePrecedence ?? 'FIRST_MATCH';
  const missingClaims = [
    ...new Set(
      rules.map(rule => rule.claim).filter(claim => readOidcClaim(claims, claim) === undefined)
    ),
  ];
  const unmatched: OidcRoleEvaluation = {
    outcome: 'UNMATCHED',
    role: defaultRole,
    matchedRule: null,
    // With no rules there is nothing to be unmatched against; deny only applies to rules.
    deny: rules.length > 0 && policy.unmatchedPolicy === 'DENY',
    missingClaims,
  };
  if (rules.length === 0) return unmatched;
  if (usesGroupsClaim(rules) && hasGroupOverage(claims))
    return {
      outcome: 'INCOMPLETE',
      role: defaultRole,
      matchedRule: null,
      deny: false,
      missingClaims,
    };

  let best: OidcRoleRule | null = null;
  for (const rule of rules) {
    if (!oidcRuleMatches(claims, rule)) continue;
    if (precedence === 'FIRST_MATCH') {
      best = rule;
      break;
    }
    if (!best || OIDC_ROLE_RANK[rule.role] > OIDC_ROLE_RANK[best.role]) best = rule;
  }
  if (!best) return unmatched;
  return { outcome: 'MATCHED', role: best.role, matchedRule: best, deny: false, missingClaims };
}

/**
 * The role a person ends up with after signing in, given who currently owns their role.
 *
 * - Manual roles are an explicit administrator decision and are never overwritten by the
 *   identity provider, except on an account's very first SSO link when a rule matches: that is
 *   the moment an existing account moves under directory control.
 * - Incomplete claims never change a role.
 */
export function resolveSignInRole(
  evaluation: OidcRoleEvaluation,
  current: { role: OidcRole; roleSource: 'MANUAL' | 'OIDC' | 'SCIM' },
  options: { firstLink?: boolean } = {}
): { role: OidcRole; roleSource: 'MANUAL' | 'OIDC' | 'SCIM'; changed: boolean } {
  if (evaluation.outcome === 'INCOMPLETE') return { ...current, changed: false };
  // Anything not explicitly directory-managed is treated as an administrator's decision.
  const directoryManaged = current.roleSource === 'OIDC' || current.roleSource === 'SCIM';
  if (!directoryManaged && !(options.firstLink && evaluation.outcome === 'MATCHED'))
    return { ...current, changed: false };
  const role = evaluation.role;
  return {
    role,
    roleSource: 'OIDC',
    changed: role !== current.role || current.roleSource !== 'OIDC',
  };
}

const MAX_SNAPSHOT_VALUES_PER_CLAIM = 200;

/**
 * The values of only the claims that role and team rules read, bounded, so administrators can
 * preview who a rule change affects. Never the whole token.
 */
export function oidcClaimSnapshot(
  claims: OidcClaims,
  rules: Array<{ claim: string }>
): Record<string, string[]> | null {
  const snapshot = new Map<string, string[]>();
  for (const claim of new Set(rules.map(rule => rule.claim))) {
    const raw = readOidcClaim(claims, claim);
    if (raw === undefined) continue;
    snapshot.set(
      claim,
      oidcClaimValues(raw)
        .slice(0, MAX_SNAPSHOT_VALUES_PER_CLAIM)
        .map(value => value.slice(0, 256))
    );
  }
  return snapshot.size > 0 ? Object.fromEntries(snapshot) : null;
}
