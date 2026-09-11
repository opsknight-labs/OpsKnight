import { describe, expect, it } from 'vitest';
import {
  detectOidcProviderType,
  hasOidcEmailLinkAssurance,
  normalizeOidcProviderType,
  requiresOidcEmailVerifiedClaim,
} from '@/lib/oidc-provider';

describe('OIDC provider compatibility policy', () => {
  it.each([
    ['https://accounts.google.com', 'google'],
    ['https://acme.okta.com/oauth2/default', 'okta'],
    ['https://acme.oktapreview.com/oauth2/default', 'okta'],
    ['https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0', 'azure'],
    ['https://login.microsoftonline.us/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0', 'azure'],
    ['https://login.partner.microsoftonline.cn/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0', 'azure'],
    ['https://acme.us.auth0.com/', 'auth0'],
    ['https://login.example.com/oidc', 'custom'],
  ])('detects %s as %s', (issuer, expected) => {
    expect(detectOidcProviderType(issuer)).toBe(expected);
  });

  it.each([
    'https://google.example.com',
    'https://okta.example.com',
    'https://foo.okta.evil.com',
    'https://microsoftonline.example.com',
    'https://login.microsoftonline.us.evil.example',
    'https://login.partner.microsoftonline.cn.evil.example',
    'https://auth0.example.com',
  ])('does not trust lookalike provider hostname %s', issuer => {
    expect(detectOidcProviderType(issuer)).toBe('custom');
  });

  it('uses issuer detection as the authority over a persisted provider type', () => {
    expect(
      normalizeOidcProviderType('custom', 'https://login.microsoftonline.com/tenant-id/v2.0')
    ).toBe('azure');
    expect(normalizeOidcProviderType('azure', 'https://login.example.com')).toBe('custom');
    expect(normalizeOidcProviderType('google', 'https://login.example.com')).toBe('custom');
    expect(normalizeOidcProviderType('auth0', 'https://login.example.com')).toBe('auth0');
    expect(normalizeOidcProviderType('okta', 'https://login.example.com')).toBe('okta');
    expect(normalizeOidcProviderType('auth0', 'https://accounts.google.com')).toBe('google');
    expect(
      normalizeOidcProviderType('custom', 'https://login.microsoftonline.us/tenant-id/v2.0')
    ).toBe('azure');
    expect(
      normalizeOidcProviderType('custom', 'https://login.partner.microsoftonline.cn/tenant-id/v2.0')
    ).toBe('azure');
    expect(normalizeOidcProviderType('unexpected', 'https://accounts.google.com')).toBe('google');
  });

  it('uses the persisted provider type only when no issuer is available', () => {
    expect(normalizeOidcProviderType('azure', null)).toBe('azure');
    expect(normalizeOidcProviderType('unexpected', null)).toBe('custom');
  });

  it('allows Entra to omit email_verified even when strict mode is enabled', () => {
    expect(requiresOidcEmailVerifiedClaim('azure', true)).toBe(false);
    expect(requiresOidcEmailVerifiedClaim('google', true)).toBe(true);
    expect(requiresOidcEmailVerifiedClaim('custom', true)).toBe(true);
    expect(requiresOidcEmailVerifiedClaim('custom', false)).toBe(false);
  });

  it('treats a missing email_verified claim as sufficient only for Entra linking', () => {
    expect(hasOidcEmailLinkAssurance('azure', undefined)).toBe(true);
    expect(hasOidcEmailLinkAssurance('google', undefined)).toBe(false);
    expect(hasOidcEmailLinkAssurance('custom', undefined)).toBe(false);
    expect(hasOidcEmailLinkAssurance('custom', true)).toBe(true);
    expect(hasOidcEmailLinkAssurance('azure', false)).toBe(false);
  });
});
