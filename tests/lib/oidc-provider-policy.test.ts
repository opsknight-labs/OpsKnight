import { describe, expect, it } from 'vitest';
import { getOidcProviderPolicy } from '@/lib/oidc/provider-policy';

describe('OIDC provider security policy registry', () => {
  it('derives Entra relaxation only from a validated Microsoft authority', () => {
    expect(
      getOidcProviderPolicy(
        'https://login.microsoftonline.com/tenant/v2.0'
      ).allowsMissingEmailVerified()
    ).toBe(true);
    expect(
      getOidcProviderPolicy('https://login.example.com/tenant/v2.0').allowsMissingEmailVerified()
    ).toBe(false);
  });

  it('locks Google security policy to the canonical issuer', () => {
    const policy = getOidcProviderPolicy('https://accounts.google.com');
    expect(policy.family).toBe('google');
    expect(policy.validateIssuer(new URL('https://accounts.google.com'))).toBe(true);
    expect(policy.validateIssuer(new URL('https://evil.google.com'))).toBe(false);
  });

  it('enforces Auth0 enterprise token algorithms independently of custom UI labels', () => {
    expect(getOidcProviderPolicy('https://tenant.auth0.com').acceptedIdTokenAlgorithms).toEqual([
      'RS256',
    ]);
    expect(getOidcProviderPolicy('https://login.example.com').acceptedIdTokenAlgorithms).toEqual([
      'RS256',
    ]);
  });

  it('supports strict Auth0 and Okta policy on custom domains without enabling Entra relaxation', () => {
    expect(getOidcProviderPolicy('https://login.example.com', 'auth0').family).toBe('auth0');
    expect(getOidcProviderPolicy('https://login.example.com', 'okta').family).toBe('okta');
    expect(getOidcProviderPolicy('https://login.example.com', 'azure').family).toBe('custom');
  });

  it('requires an exact signed Auth0 organization claim when configured', () => {
    const policy = getOidcProviderPolicy('https://tenant.auth0.com');
    expect(
      policy.validateOrganizationBoundary({ org_id: 'org_expected' }, [], 'org_expected')
    ).toEqual({ ok: true });
    expect(
      policy.validateOrganizationBoundary({ org_id: 'org_other' }, [], 'org_expected')
    ).toEqual({
      ok: false,
      reason: 'OIDC_ORGANIZATION_REJECTED',
    });
    expect(policy.validateOrganizationBoundary({}, [], 'org_expected')).toEqual({
      ok: false,
      reason: 'OIDC_ORGANIZATION_REJECTED',
    });
  });

  it('enforces Allowed Domains as an additional filter on Microsoft Entra policy', () => {
    const policy = getOidcProviderPolicy('https://login.microsoftonline.com/tenant/v2.0');
    expect(policy.family).toBe('azure');

    // Without allowedDomains configured, any verified tenant user is permitted
    expect(policy.validateOrganizationBoundary({ email: 'user@anywhere.com' }, [])).toEqual({
      ok: true,
    });

    // With allowedDomains configured, acts as an additional email domain filter
    expect(
      policy.validateOrganizationBoundary(
        { email: 'user@acme.com' },
        ['acme.com', 'subsidiary.acme.com']
      )
    ).toEqual({ ok: true });

    expect(
      policy.validateOrganizationBoundary(
        { email: 'user@external.com' },
        ['acme.com', 'subsidiary.acme.com']
      )
    ).toEqual({
      ok: false,
      reason: 'OIDC_ORGANIZATION_REJECTED',
    });
  });
});
