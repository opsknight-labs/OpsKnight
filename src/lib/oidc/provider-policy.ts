import {
  detectOidcProviderType,
  isMicrosoftEntraGenericAuthority,
  getMicrosoftEntraTenantAuthority,
  type OidcProviderType,
} from '@/lib/oidc-provider';

export type OidcClaims = Record<string, unknown>;

export type OrganizationPolicyResult =
  | { ok: true }
  | { ok: false; reason: 'OIDC_ORGANIZATION_REJECTED' };

export interface OidcProviderPolicy {
  readonly family: OidcProviderType;
  readonly acceptedIdTokenAlgorithms: readonly string[];
  validateIssuer(issuer: URL): boolean;
  validateOrganizationBoundary(
    claims: OidcClaims,
    allowedDomains: string[],
    organizationId?: string | null
  ): OrganizationPolicyResult;
  allowsMissingEmailVerified(): boolean;
}

function normalizedAllowed(values: string[]): Set<string> {
  return new Set(values.map(value => value.trim().toLowerCase()).filter(Boolean));
}

function emailDomain(claims: OidcClaims): string | null {
  if (typeof claims.email !== 'string') return null;
  const separator = claims.email.lastIndexOf('@');
  return separator > 0
    ? claims.email
        .slice(separator + 1)
        .trim()
        .toLowerCase()
    : null;
}

function emailBoundary(claims: OidcClaims, allowedDomains: string[]): OrganizationPolicyResult {
  const allowed = normalizedAllowed(allowedDomains);
  if (allowed.size === 0) return { ok: true };
  const domain = emailDomain(claims);
  return domain && allowed.has(domain)
    ? { ok: true }
    : { ok: false, reason: 'OIDC_ORGANIZATION_REJECTED' };
}

const genericPolicy: OidcProviderPolicy = {
  family: 'custom',
  // The Auth.js/openid-client runtime is pinned to RS256. Keep discovery
  // validation identical so an ES256-only provider cannot pass testing and
  // then fail during its first real callback.
  acceptedIdTokenAlgorithms: ['RS256'],
  validateIssuer: () => true,
  validateOrganizationBoundary: emailBoundary,
  allowsMissingEmailVerified: () => false,
};

const googlePolicy: OidcProviderPolicy = {
  family: 'google',
  acceptedIdTokenAlgorithms: ['RS256'],
  validateIssuer: issuer =>
    issuer.protocol === 'https:' &&
    issuer.hostname === 'accounts.google.com' &&
    issuer.pathname === '/',
  validateOrganizationBoundary: (claims, allowedDomains) => {
    const allowed = normalizedAllowed(allowedDomains);
    if (allowed.size === 0) return { ok: true };
    // The signed hd claim is the Workspace membership assertion. Email domain
    // and the authorization-request hd parameter are not security boundaries.
    const hostedDomain = typeof claims.hd === 'string' ? claims.hd.trim().toLowerCase() : null;
    return hostedDomain && allowed.has(hostedDomain)
      ? { ok: true }
      : { ok: false, reason: 'OIDC_ORGANIZATION_REJECTED' };
  },
  allowsMissingEmailVerified: () => false,
};

const entraPolicy: OidcProviderPolicy = {
  family: 'azure',
  acceptedIdTokenAlgorithms: ['RS256'],
  validateIssuer: issuer => {
    const authority = getMicrosoftEntraTenantAuthority(issuer);
    return authority !== null && !isMicrosoftEntraGenericAuthority(authority);
  },
  // Entra tenant membership is enforced by tenant-specific issuer validation.
  // When configured, Allowed Domains acts as an additional email domain filter.
  validateOrganizationBoundary: emailBoundary,
  allowsMissingEmailVerified: () => true,
};

const oktaPolicy: OidcProviderPolicy = {
  ...genericPolicy,
  family: 'okta',
  acceptedIdTokenAlgorithms: ['RS256'],
};

const auth0Policy: OidcProviderPolicy = {
  ...genericPolicy,
  family: 'auth0',
  acceptedIdTokenAlgorithms: ['RS256'],
  validateOrganizationBoundary: (claims, allowedDomains, organizationId) => {
    if (organizationId) {
      const assertedOrganization = typeof claims.org_id === 'string' ? claims.org_id.trim() : null;
      if (assertedOrganization !== organizationId.trim()) {
        return { ok: false, reason: 'OIDC_ORGANIZATION_REJECTED' };
      }
    }
    return emailBoundary(claims, allowedDomains);
  },
};

/** Security policy is derived from the trusted issuer, never from UI branding. */
export function getOidcProviderPolicy(
  issuer: string,
  configuredFamily?: string | null
): OidcProviderPolicy {
  const detected = detectOidcProviderType(issuer);
  // Auth0 and Okta custom domains are indistinguishable by hostname. Allow an
  // explicit family only where it tightens the generic policy. Entra/Google
  // policy can never be selected without their validated canonical authority.
  if (detected === 'custom' && (configuredFamily === 'auth0' || configuredFamily === 'okta')) {
    return configuredFamily === 'auth0' ? auth0Policy : oktaPolicy;
  }
  switch (detected) {
    case 'google':
      return googlePolicy;
    case 'azure':
      return entraPolicy;
    case 'okta':
      return oktaPolicy;
    case 'auth0':
      return auth0Policy;
    default:
      return genericPolicy;
  }
}
