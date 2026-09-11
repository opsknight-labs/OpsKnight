export const OIDC_LINKING_APPROVAL_TTL_HOURS = 168;

export type OidcLinkingApprovalRecord = {
  revokedAt: Date | null;
  consumedAt?: Date | null;
  expiresAt: Date | null;
};

export type OidcLinkingApprovalState =
  | 'not-approved'
  | 'approved'
  | 'expired'
  | 'revoked'
  | 'consumed';

/**
 * Single source of truth for whether a first-time OIDC linking approval is
 * usable. Authentication and administration must use the same state machine.
 */
export function getOidcLinkingApprovalState(
  approval: OidcLinkingApprovalRecord | null | undefined,
  now = new Date()
): OidcLinkingApprovalState {
  if (!approval) return 'not-approved';
  if (approval.consumedAt) return 'consumed';
  if (approval.revokedAt) return 'revoked';
  if (approval.expiresAt && approval.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'approved';
}

export function isOidcLinkingApprovalUsable(
  approval: OidcLinkingApprovalRecord | null | undefined,
  now = new Date()
): boolean {
  return getOidcLinkingApprovalState(approval, now) === 'approved';
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
