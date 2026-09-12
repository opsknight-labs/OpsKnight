export const OIDC_LINKING_APPROVAL_TTL_HOURS = 168;

export type OidcLinkingApprovalRecord = {
  revokedAt: Date | null;
  consumedAt?: Date | null;
  expiresAt: Date | null;
  providerConfigId?: string | null;
  issuerFingerprint?: string | null;
  configVersion?: number | null;
};

export type CurrentProviderTrustContext = {
  providerConfigId?: string | null;
  issuerFingerprint?: string | null;
  configVersion?: number | null;
};

export type OidcLinkingApprovalState =
  | 'not-approved'
  | 'approved'
  | 'expired'
  | 'revoked'
  | 'consumed'
  | 'stale';

/**
 * Single source of truth for whether a first-time OIDC linking approval is
 * usable. Authentication and administration must use the same state machine.
 */
export function getOidcLinkingApprovalState(
  approval: OidcLinkingApprovalRecord | null | undefined,
  now = new Date(),
  providerContext?: CurrentProviderTrustContext | null
): OidcLinkingApprovalState {
  if (!approval) return 'not-approved';
  if (approval.consumedAt) return 'consumed';
  if (approval.revokedAt) return 'revoked';
  if (approval.expiresAt && approval.expiresAt.getTime() <= now.getTime()) return 'expired';

  if (providerContext) {
    if (
      (approval.providerConfigId &&
        providerContext.providerConfigId &&
        approval.providerConfigId !== providerContext.providerConfigId) ||
      (approval.issuerFingerprint &&
        providerContext.issuerFingerprint &&
        approval.issuerFingerprint !== providerContext.issuerFingerprint) ||
      (approval.configVersion != null &&
        providerContext.configVersion != null &&
        approval.configVersion !== providerContext.configVersion)
    ) {
      return 'stale';
    }
  }

  return 'approved';
}

export function isOidcLinkingApprovalUsable(
  approval: OidcLinkingApprovalRecord | null | undefined,
  now = new Date(),
  providerContext?: CurrentProviderTrustContext | null
): boolean {
  return getOidcLinkingApprovalState(approval, now, providerContext) === 'approved';
}

/**
 * Approval lifetime is intentionally an internal security policy for now.
 * Keeping it out of an environment variable prevents malformed configuration
 * from silently creating non-expiring approvals. If customer configurability
 * is added later it should be a validated, typed OIDC setting.
 */
export function getOidcLinkingApprovalExpiry(now = new Date()): Date {
  return new Date(now.getTime() + OIDC_LINKING_APPROVAL_TTL_HOURS * 60 * 60 * 1000);
}
