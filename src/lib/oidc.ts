import type { OAuthConfig } from 'next-auth/providers/oauth';
import { logger } from '@/lib/logger';
import { safeOutboundLookup } from '@/lib/network-security';
import type { OidcRuntimeMetadata } from '@/lib/oidc-validation';
import { normalizeOidcIssuer } from '@/lib/oidc/issuer-migration';

type OIDCConfig = {
  clientId: string;
  clientSecret: string;
  issuer: string;
  customScopes?: string | null;
  metadata: OidcRuntimeMetadata;
  tokenEndpointAuthMethod?: string | null;
  providerType?: string | null;
  organizationId?: string | null;
};

type OIDCProfile = {
  sub?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  [key: string]: unknown;
};

export default function OIDCProvider(config: OIDCConfig): OAuthConfig<OIDCProfile> {
  const issuer = normalizeOidcIssuer(config.issuer);
  const scopes = `openid email profile ${config.customScopes || ''}`.trim();
  const tokenEndpointAuthMethod =
    config.tokenEndpointAuthMethod === 'client_secret_post'
      ? 'client_secret_post'
      : 'client_secret_basic';

  const authorizationParams: Record<string, string> = {
    scope: scopes,
    ...(config.providerType === 'auth0' && config.organizationId?.trim()
      ? { organization: config.organizationId.trim() }
      : {}),
  };

  logger.info('[OIDC] Initializing OIDC provider', {
    component: 'OIDCProvider',
    issuer,
    clientId: config.clientId,
    scopes,
    hasCustomScopes: !!config.customScopes,
    tokenEndpointAuthMethod,
    providerType: config.providerType ?? 'custom',
    hasOrganizationId: !!config.organizationId,
  });

  const canonicalIssuer = config.metadata.issuer || issuer;

  return {
    id: 'oidc',
    name: 'SSO',
    type: 'oauth',
    issuer: canonicalIssuer,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorization: {
      url: config.metadata.authorizationEndpoint,
      params: authorizationParams,
    },
    token: { url: config.metadata.tokenEndpoint },
    jwks_endpoint: config.metadata.jwksUri,
    // openid-client performs the real token/JWKS calls. Its socket lookup must
    // enforce the same all-address SSRF/DNS-rebinding policy as validation.
    httpOptions: { lookup: safeOutboundLookup, timeout: 5000 },
    // openid-client validates the JOSE header against this client metadata at
    // callback time. This rejects alg=none, HS256, and algorithm downgrade;
    // discovery-time advertising alone is not a runtime security control.
    client: {
      id_token_signed_response_alg: 'RS256',
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    },
    idToken: true,
    checks: ['pkce', 'state', 'nonce'],
    profile(profile) {
      logger.debug('[OIDC] Processing profile from IdP', {
        component: 'OIDCProvider',
        sub: profile.sub,
        email: profile.email,
        hasName: !!profile.name,
        hasPreferredUsername: !!profile.preferred_username,
        claimKeys: Object.keys(profile),
      });

      const mappedProfile = {
        id: profile.sub ?? '',
        name: profile.name ?? profile.preferred_username ?? profile.email ?? null,
        email: profile.email ?? null,
      };

      logger.debug('[OIDC] Mapped profile for NextAuth', {
        component: 'OIDCProvider',
        id: mappedProfile.id,
        email: mappedProfile.email,
        hasName: !!mappedProfile.name,
      });

      return mappedProfile;
    },
  };
}
