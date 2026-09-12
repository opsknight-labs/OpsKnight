import { describe, expect, it } from 'vitest';
import OIDCProvider from '@/lib/oidc';
import { safeOutboundLookup } from '@/lib/network-security';

describe('OIDC runtime provider networking', () => {
  it('pins validated HTTPS endpoints and applies protected socket lookup', () => {
    const provider = OIDCProvider({
      issuer: 'https://identity.example.com',
      clientId: 'client-id',
      clientSecret: 'secret',
      metadata: {
        issuer: 'https://identity.example.com',
        authorizationEndpoint: 'https://identity.example.com/authorize',
        tokenEndpoint: 'https://identity.example.com/token',
        jwksUri: 'https://identity.example.com/jwks',
      },
    });

    expect(provider.wellKnown).toBeUndefined();
    expect(provider.authorization).toEqual(
      expect.objectContaining({ url: 'https://identity.example.com/authorize' })
    );
    expect(provider.token).toEqual(
      expect.objectContaining({ url: 'https://identity.example.com/token' })
    );
    expect(provider.jwks_endpoint).toBe('https://identity.example.com/jwks');
    expect(provider.httpOptions).toEqual(
      expect.objectContaining({ lookup: safeOutboundLookup, timeout: 5000 })
    );
    expect(provider.client?.id_token_signed_response_alg).toBe('RS256');
  });

  it('uses canonical metadata issuer to match IdP ID token iss claim', () => {
    const provider = OIDCProvider({
      issuer: 'https://dev-example.us.auth0.com',
      clientId: 'client-id',
      clientSecret: 'secret',
      metadata: {
        issuer: 'https://dev-example.us.auth0.com/',
        authorizationEndpoint: 'https://dev-example.us.auth0.com/authorize',
        tokenEndpoint: 'https://dev-example.us.auth0.com/oauth/token',
        jwksUri: 'https://dev-example.us.auth0.com/.well-known/jwks.json',
      },
    });

    // openid-client validateJWT matches payload.iss strictly against this.issuer.issuer.
    // Auth0 (and other providers) advertise and sign with trailing slash in iss.
    expect(provider.issuer).toBe('https://dev-example.us.auth0.com/');
  });

  it('configures client_secret_post and defaults to client_secret_basic', () => {
    const defaultProvider = OIDCProvider({
      issuer: 'https://identity.example.com',
      clientId: 'client-id',
      clientSecret: 'secret',
      metadata: {
        issuer: 'https://identity.example.com',
        authorizationEndpoint: 'https://identity.example.com/authorize',
        tokenEndpoint: 'https://identity.example.com/token',
        jwksUri: 'https://identity.example.com/jwks',
      },
    });
    expect(defaultProvider.client?.token_endpoint_auth_method).toBe('client_secret_basic');

    const postProvider = OIDCProvider({
      issuer: 'https://identity.example.com',
      clientId: 'client-id',
      clientSecret: 'secret',
      tokenEndpointAuthMethod: 'client_secret_post',
      metadata: {
        issuer: 'https://identity.example.com',
        authorizationEndpoint: 'https://identity.example.com/authorize',
        tokenEndpoint: 'https://identity.example.com/token',
        jwksUri: 'https://identity.example.com/jwks',
      },
    });
    expect(postProvider.client?.token_endpoint_auth_method).toBe('client_secret_post');
  });

  it('includes organization parameter in authorization params for Auth0 when configured', () => {
    const auth0WithOrg = OIDCProvider({
      issuer: 'https://tenant.us.auth0.com',
      clientId: 'client-id',
      clientSecret: 'secret',
      providerType: 'auth0',
      organizationId: 'org_abc123',
      metadata: {
        issuer: 'https://tenant.us.auth0.com/',
        authorizationEndpoint: 'https://tenant.us.auth0.com/authorize',
        tokenEndpoint: 'https://tenant.us.auth0.com/oauth/token',
        jwksUri: 'https://tenant.us.auth0.com/.well-known/jwks.json',
      },
    });
    expect(
      (auth0WithOrg.authorization as { params?: Record<string, string> })?.params?.organization
    ).toBe('org_abc123');

    // Without organizationId
    const auth0NoOrg = OIDCProvider({
      issuer: 'https://tenant.us.auth0.com',
      clientId: 'client-id',
      clientSecret: 'secret',
      providerType: 'auth0',
      organizationId: null,
      metadata: {
        issuer: 'https://tenant.us.auth0.com/',
        authorizationEndpoint: 'https://tenant.us.auth0.com/authorize',
        tokenEndpoint: 'https://tenant.us.auth0.com/oauth/token',
        jwksUri: 'https://tenant.us.auth0.com/.well-known/jwks.json',
      },
    });
    expect(
      (auth0NoOrg.authorization as { params?: Record<string, string> })?.params?.organization
    ).toBeUndefined();

    // Non-Auth0 provider with organizationId should not have organization param in OAuth authorization
    const oktaWithOrg = OIDCProvider({
      issuer: 'https://example.okta.com',
      clientId: 'client-id',
      clientSecret: 'secret',
      providerType: 'okta',
      organizationId: 'org_abc123',
      metadata: {
        issuer: 'https://example.okta.com',
        authorizationEndpoint: 'https://example.okta.com/oauth2/v1/authorize',
        tokenEndpoint: 'https://example.okta.com/oauth2/v1/token',
        jwksUri: 'https://example.okta.com/oauth2/v1/keys',
      },
    });
    expect(
      (oktaWithOrg.authorization as { params?: Record<string, string> })?.params?.organization
    ).toBeUndefined();
  });

  it('normalizes pathological multiple trailing slashes using normalizeOidcIssuer', () => {
    const provider = OIDCProvider({
      issuer: 'https://identity.example.com///',
      clientId: 'client-id',
      clientSecret: 'secret',
      metadata: {
        issuer: '', // fallback to normalized issuer
        authorizationEndpoint: 'https://identity.example.com/authorize',
        tokenEndpoint: 'https://identity.example.com/token',
        jwksUri: 'https://identity.example.com/jwks',
      },
    });
    expect(provider.issuer).toBe('https://identity.example.com');
  });
});
