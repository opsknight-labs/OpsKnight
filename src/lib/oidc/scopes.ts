import type { OidcProviderType } from '@/lib/oidc-provider';

const BUILT_IN_SCOPES = new Set(['openid', 'email', 'profile']);
const FORBIDDEN_PROVIDER_SCOPES: Partial<Record<OidcProviderType, Set<string>>> = {
  azure: new Set(['groups', 'roles']),
  google: new Set(['groups', 'roles']),
};

export type OidcScopeValidation =
  | { ok: true; scopes: string | null }
  | { ok: false; error: string };

export function isOidcCustomScopeAllowed(scope: string, providerType: string): boolean {
  if (BUILT_IN_SCOPES.has(scope)) return false;
  if (scope === 'offline_access') return false;
  return !FORBIDDEN_PROVIDER_SCOPES[providerType as OidcProviderType]?.has(scope);
}

export function validateOidcCustomScopes(
  value: string | null | undefined,
  providerType: string | null | undefined
): OidcScopeValidation {
  const scopes = [
    ...new Set(
      (value ?? '')
        .split(/\s+/)
        .map(scope => scope.trim())
        .filter(Boolean)
    ),
  ].filter(scope => !BUILT_IN_SCOPES.has(scope));

  if (scopes.includes('offline_access')) {
    return {
      ok: false,
      error:
        'The offline_access scope is not supported because OpsKnight does not store or use OIDC refresh tokens.',
    };
  }

  const forbidden = FORBIDDEN_PROVIDER_SCOPES[providerType as OidcProviderType];
  const invalid = forbidden ? scopes.filter(scope => forbidden.has(scope)) : [];
  if (invalid.length > 0) {
    const providerName = providerType === 'azure' ? 'Microsoft Entra ID' : 'Google';
    return {
      ok: false,
      error: `${invalid.join(', ')} ${invalid.length === 1 ? 'is' : 'are'} not valid OAuth scopes for ${providerName}. Configure token claims at the identity provider instead.`,
    };
  }

  return { ok: true, scopes: scopes.length > 0 ? scopes.join(' ') : null };
}

export function oidcScopeSuggestions(providerType: string): string[] {
  if (providerType === 'okta') return ['groups'];
  if (providerType === 'custom') return ['groups', 'roles'];
  return [];
}
