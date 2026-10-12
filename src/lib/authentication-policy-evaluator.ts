/** Pure policy rules. All callers obtain the policy from authoritative PostgreSQL state. */
export type AuthenticationMode = 'PASSWORD_ONLY' | 'SSO_OPTIONAL' | 'SSO_REQUIRED';
export type AuthenticationAction = 'PASSWORD_LOGIN' | 'PASSWORD_WRITE' | 'OIDC_LOGIN' | 'SESSION';
export type AuthenticationMethod = 'credentials' | 'oidc' | 'legacy-emergency';

export interface AuthenticationPolicyState {
  mode: AuthenticationMode;
  version: number;
  legacyEmergencyEmail: string | null;
  passwordSessionMinVersion?: number;
  oidcSessionMinVersion?: number;
}

export function evaluateAuthenticationPolicy(
  policy: AuthenticationPolicyState,
  action: AuthenticationAction,
  principal: { email?: string | null } = {},
  session: { method?: AuthenticationMethod; policyVersion?: number } = {}
): { allowed: boolean; reason: string; version: number } {
  const deny = (reason: string) => ({ allowed: false, reason, version: policy.version });
  if (
    !['PASSWORD_ONLY', 'SSO_OPTIONAL', 'SSO_REQUIRED'].includes(policy.mode) ||
    !Number.isSafeInteger(policy.version) ||
    policy.version < 1
  )
    return deny('INVALID_AUTHENTICATION_POLICY');
  for (const cutoff of [policy.passwordSessionMinVersion ?? 0, policy.oidcSessionMinVersion ?? 0]) {
    if (!Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > policy.version)
      return deny('INVALID_AUTHENTICATION_POLICY');
  }
  if (
    session.policyVersion != null &&
    (!Number.isSafeInteger(session.policyVersion) ||
      session.policyVersion > policy.version ||
      session.policyVersion < 1)
  )
    return deny('INVALID_POLICY_VERSION');
  if (
    session.method != null &&
    !['credentials', 'oidc', 'legacy-emergency'].includes(session.method)
  )
    return deny('INVALID_AUTHENTICATION_METHOD');
  const legacyEmergency =
    policy.legacyEmergencyEmail != null &&
    principal.email?.trim().toLowerCase() === policy.legacyEmergencyEmail;
  let allowed = false;
  if (action === 'PASSWORD_LOGIN') allowed = policy.mode !== 'SSO_REQUIRED' || legacyEmergency;
  if (action === 'PASSWORD_WRITE') allowed = policy.mode !== 'SSO_REQUIRED';
  if (action === 'OIDC_LOGIN') allowed = policy.mode !== 'PASSWORD_ONLY';
  if (action === 'SESSION') {
    if (legacyEmergency && session.method !== 'oidc' && session.method !== 'legacy-emergency')
      return deny('EMERGENCY_REAUTH_REQUIRED');
    const cutoff =
      session.method === 'oidc'
        ? (policy.oidcSessionMinVersion ?? 0)
        : (policy.passwordSessionMinVersion ?? 0);
    if (session.method !== 'legacy-emergency' && (session.policyVersion ?? 0) < cutoff)
      return deny('SESSION_REVOKED_BY_POLICY');
    // Unknown pre-upgrade methods are local sessions. Never infer OIDC from an email address.
    allowed =
      session.method === 'oidc'
        ? policy.mode !== 'PASSWORD_ONLY'
        : session.method === 'legacy-emergency'
          ? legacyEmergency
          : policy.mode !== 'SSO_REQUIRED';
  }
  return {
    allowed,
    reason: allowed ? 'ALLOWED' : 'AUTHENTICATION_POLICY_DENIED',
    version: policy.version,
  };
}
