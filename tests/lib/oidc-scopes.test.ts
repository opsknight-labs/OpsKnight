import { describe, expect, it } from 'vitest';
import {
  isOidcCustomScopeAllowed,
  oidcScopeSuggestions,
  validateOidcCustomScopes,
} from '@/lib/oidc/scopes';

describe('OIDC provider scope policy', () => {
  it('rejects Entra claim names supplied as OAuth scopes', () => {
    expect(validateOidcCustomScopes('groups', 'azure')).toEqual({
      ok: false,
      error: expect.stringContaining('not valid OAuth scopes for Microsoft Entra ID'),
    });
    expect(isOidcCustomScopeAllowed('roles', 'azure')).toBe(false);
  });

  it('rejects unsupported Google claim scopes', () => {
    expect(validateOidcCustomScopes('roles', 'google')).toEqual({
      ok: false,
      error: expect.stringContaining('not valid OAuth scopes for Google'),
    });
    expect(oidcScopeSuggestions('google')).toEqual([]);
  });

  it('rejects offline access until refresh-token lifecycle support exists', () => {
    expect(validateOidcCustomScopes('offline_access', 'okta')).toEqual({
      ok: false,
      error: expect.stringContaining('does not store or use OIDC refresh tokens'),
    });
  });

  it('normalizes built-in and duplicate scopes while retaining supported custom scopes', () => {
    expect(validateOidcCustomScopes('openid profile groups groups', 'okta')).toEqual({
      ok: true,
      scopes: 'groups',
    });
    expect(oidcScopeSuggestions('okta')).toEqual(['groups']);
  });
});
