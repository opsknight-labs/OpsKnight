export type OidcProviderType = 'google' | 'okta' | 'azure' | 'auth0' | 'custom';

const MICROSOFT_ENTRA_HOSTS = new Set([
  'login.microsoftonline.com',
  'login.microsoftonline.us',
  'login.partner.microsoftonline.cn',
  'login.microsoft.com',
  'sts.windows.net',
  'microsoftonline.com',
]);

const MICROSOFT_ENTRA_GENERIC_AUTHORITIES = new Set(['common', 'organizations', 'consumers']);

function isKnownProviderType(value: string | null | undefined): value is OidcProviderType {
  return (
    value === 'google' ||
    value === 'okta' ||
    value === 'azure' ||
    value === 'auth0' ||
    value === 'custom'
  );
}

export function isMicrosoftEntraHost(hostname: string): boolean {
  return MICROSOFT_ENTRA_HOSTS.has(hostname.toLowerCase());
}

/**
 * Return the Entra authority/tenant segment from a recognized Microsoft issuer.
 * For https://login.microsoftonline.com/<tenant>/v2.0 this is <tenant>, not
 * the trailing protocol-version segment.
 */
export function getMicrosoftEntraTenantAuthority(url: URL): string | null {
  if (!isMicrosoftEntraHost(url.hostname)) return null;
  const [authority] = url.pathname.split('/').filter(Boolean);
  return authority?.toLowerCase() ?? null;
}

export function isMicrosoftEntraGenericAuthority(authority: string | null): boolean {
  return authority !== null && MICROSOFT_ENTRA_GENERIC_AUTHORITIES.has(authority.toLowerCase());
}

/**
 * Detect the built-in provider family from an OIDC issuer hostname.
 *
 * Hostname matching is intentionally strict: provider detection is used by
 * authentication policy as well as UI branding, so lookalike hostnames must
 * never inherit provider-specific authentication behavior.
 */
export function detectOidcProviderType(issuerUrl: string | null | undefined): OidcProviderType {
  if (!issuerUrl) return 'custom';

  let hostname: string;
  try {
    hostname = new URL(issuerUrl).hostname.toLowerCase();
  } catch {
    return 'custom';
  }

  if (
    hostname === 'accounts.google.com' ||
    hostname === 'googleapis.com' ||
    hostname.endsWith('.google.com') ||
    hostname.endsWith('.googleapis.com')
  ) {
    return 'google';
  }

  const oktaHosts = ['okta.com', 'okta-emea.com', 'oktapreview.com', 'okta-gov.com'];
  if (oktaHosts.some(host => hostname === host || hostname.endsWith(`.${host}`))) {
    return 'okta';
  }

  if (isMicrosoftEntraHost(hostname)) {
    return 'azure';
  }

  if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
    return 'auth0';
  }

  return 'custom';
}

/**
 * A canonical provider issuer is always authoritative. Custom hostnames cannot
 * identify an Auth0 or Okta tenant by themselves, so preserve those two stored
 * families where they only tighten the generic policy. Never let a stored
 * Entra or Google label grant special trust to an arbitrary hostname.
 *
 * The return is typed as string because persisted UI presets are extensible;
 * all values produced here are still constrained to OidcProviderType.
 */
export function normalizeOidcProviderType(
  storedProviderType: string | null | undefined,
  issuerUrl: string | null | undefined
): string {
  if (issuerUrl) {
    const detected = detectOidcProviderType(issuerUrl);
    if (
      detected === 'custom' &&
      (storedProviderType === 'auth0' || storedProviderType === 'okta')
    ) {
      return storedProviderType;
    }
    return detected;
  }
  return isKnownProviderType(storedProviderType) ? storedProviderType : 'custom';
}

/**
 * Microsoft Entra ID workforce tokens do not reliably include the standard
 * `email_verified` claim. Requiring that claim makes otherwise valid Entra
 * OIDC sign-ins fail. Other providers keep the operator-controlled strict
 * requirement.
 */
export function requiresOidcEmailVerifiedClaim(
  providerType: string | null | undefined,
  strictMode: boolean
): boolean {
  if (!strictMode) return false;
  return providerType !== 'azure';
}

/**
 * Email assurance used only when first linking an OIDC identity to an existing
 * OpsKnight account. Explicit `email_verified: false` is rejected for every
 * provider before this helper is consulted. Entra is allowed to omit the claim
 * because issuer + subject are cryptographically validated by OIDC; account
 * state can still require a fresh one-time administrator linking approval.
 */
export function hasOidcEmailLinkAssurance(
  providerType: string | null | undefined,
  emailVerifiedClaim: boolean | undefined
): boolean {
  return (
    emailVerifiedClaim === true || (providerType === 'azure' && emailVerifiedClaim === undefined)
  );
}
