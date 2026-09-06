import type { OAuthConfig } from 'next-auth/providers/oauth';
import { logger } from '@/lib/logger';

type OIDCConfig = {
  clientId: string;
  clientSecret: string;
  issuer: string;
  customScopes?: string | null;
};

type OIDCProfile = {
  sub?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  [key: string]: any; // Allow indexing for custom claims
};

export default function OIDCProvider(config: OIDCConfig): OAuthConfig<OIDCProfile> {
  const issuer = config.issuer.replace(/\/$/, '');
  const scopes = `openid email profile ${config.customScopes || ''}`.trim();
  const wellKnownUrl = `${issuer}/.well-known/openid-configuration`;

  logger.info('[OIDC] Initializing OIDC provider', {
    component: 'OIDCProvider',
    issuer,
    clientId: config.clientId,
    scopes,
    wellKnownUrl,
    hasCustomScopes: !!config.customScopes,
  });

  return {
    id: 'oidc',
    name: 'SSO',
    type: 'oauth',
    wellKnown: wellKnownUrl,
    issuer,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorization: { params: { scope: scopes } },
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
