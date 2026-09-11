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
});
