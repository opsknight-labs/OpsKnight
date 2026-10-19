/**
 * Administrator SSO verification proof policy.
 *
 * Product policy: a successful real administrator sign-in test stays usable for seven days,
 * but only while the identity, provider and security invariants it proved still hold. The
 * same evaluation decides activation on the server and the badges shown in the console, so
 * the UI can never show "Verified" for a proof that activation would reject.
 *
 * This module is intentionally free of server-only imports so the client can share the
 * state names and labels.
 */
export const OIDC_PROOF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type OidcProofState =
  'required' | 'valid' | 'expired' | 'config-changed' | 'admin-changed' | 'trust-mismatch';

export type OidcProofRecord = {
  verifiedAt: Date;
  verifiedOrigin: string | null;
  effectiveRole: string;
  testedConfigVersion: number;
  adminUserId: string;
  adminTokenVersion: number;
};

export type OidcProofAdministrator = {
  role: string;
  status: string;
  tokenVersion: number;
} | null;

export type OidcProofContext = {
  now: Date;
  /** Canonical authentication origin; null when origins conflict. */
  origin: string | null;
  activeConfigVersion: number;
  administrator: OidcProofAdministrator;
};

export type OidcProofStatus = {
  state: OidcProofState;
  verifiedAt: string | null;
  expiresAt: string | null;
  adminUserId: string | null;
};

export function evaluateOidcProof(
  proof: OidcProofRecord | null | undefined,
  context: OidcProofContext
): OidcProofStatus {
  if (!proof) return { state: 'required', verifiedAt: null, expiresAt: null, adminUserId: null };
  const expiresAt = new Date(proof.verifiedAt.getTime() + OIDC_PROOF_MAX_AGE_MS);
  const base = {
    verifiedAt: proof.verifiedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    adminUserId: proof.adminUserId,
  };
  if (!context.origin || proof.verifiedOrigin !== context.origin || proof.effectiveRole !== 'ADMIN')
    return { state: 'trust-mismatch', ...base };
  const admin = context.administrator;
  if (
    !admin ||
    admin.status !== 'ACTIVE' ||
    admin.role !== 'ADMIN' ||
    admin.tokenVersion !== proof.adminTokenVersion
  )
    return { state: 'admin-changed', ...base };
  if (proof.testedConfigVersion !== context.activeConfigVersion)
    return { state: 'config-changed', ...base };
  // Valid up to and including the exact seven-day boundary; rejected one millisecond later.
  if (context.now.getTime() > expiresAt.getTime()) return { state: 'expired', ...base };
  return { state: 'valid', ...base };
}

export const OIDC_PROOF_LABELS: Record<OidcProofState, { short: string; detail: string }> = {
  required: {
    short: 'Administrator test required',
    detail: 'Complete a real administrator SSO sign-in for this configuration.',
  },
  valid: {
    short: 'Verified',
    detail: 'A real administrator sign-in verified this configuration.',
  },
  expired: {
    short: 'Verification expired — retest',
    detail: 'Administrator verification is valid for seven days. Run the sign-in test again.',
  },
  'config-changed': {
    short: 'Configuration changed — retest',
    detail: 'The active provider changed after this test. Test this configuration again.',
  },
  'admin-changed': {
    short: 'Administrator must verify again',
    detail:
      'The verified administrator’s role, status or sessions changed after the test. Test again.',
  },
  'trust-mismatch': {
    short: 'Identity/provider verification invalid',
    detail:
      'The test was recorded for a different sign-in origin or without administrator access. Test again.',
  },
};

export function oidcProofLabel(state: OidcProofState) {
  // eslint-disable-next-line security/detect-object-injection -- state is a closed union of known keys.
  return OIDC_PROOF_LABELS[state];
}
