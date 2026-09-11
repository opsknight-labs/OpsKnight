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
});
