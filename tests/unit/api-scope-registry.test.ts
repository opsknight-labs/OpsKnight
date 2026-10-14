import { describe, expect, it, vi } from 'vitest';
import { API_SCOPES } from '@/lib/authorization';
import {
  API_SCOPE_REGISTRY,
  disallowedScopesForRole,
  issuableScopesForRole,
} from '@/lib/api-scope-registry';
import { resolveTokenExpiry } from '@/lib/api-v2/service-accounts';
import { isServiceAccountIdentity } from '@/lib/service-account-identity';

describe('API scope registry', () => {
  it('describes every scope in API_SCOPES, keyed by its own value', () => {
    for (const scope of Object.values(API_SCOPES)) {
      expect(API_SCOPE_REGISTRY[scope].scope).toBe(scope);
      expect(API_SCOPE_REGISTRY[scope].description.length).toBeGreaterThan(10);
    }
  });

  it('does not offer scopes that grant nothing on REST v2', () => {
    const issuable = issuableScopesForRole('ADMIN').map(d => d.scope);
    expect(issuable).not.toContain(API_SCOPES.RUNBOOKS_WRITE);
    expect(issuable).not.toContain(API_SCOPES.USERS_WRITE);
    expect(issuable).toContain(API_SCOPES.RUNBOOKS_EXECUTE);
  });

  it('keeps write and administrative scopes away from lower roles', () => {
    expect(disallowedScopesForRole('USER', [API_SCOPES.INCIDENTS_WRITE])).toEqual([
      API_SCOPES.INCIDENTS_WRITE,
    ]);
    expect(disallowedScopesForRole('RESPONDER', [API_SCOPES.INCIDENTS_WRITE])).toEqual([]);
    expect(disallowedScopesForRole('RESPONDER', [API_SCOPES.ADMIN_MANAGE])).toEqual([
      API_SCOPES.ADMIN_MANAGE,
    ]);
    expect(disallowedScopesForRole('AUDITOR', [API_SCOPES.AUDIT_READ])).toEqual([]);
    expect(disallowedScopesForRole('AUDITOR', [API_SCOPES.INCIDENTS_WRITE])).toHaveLength(1);
  });
});

describe('service-account token expiry policy', () => {
  const now = Date.UTC(2026, 0, 1);

  it('requires an explicit lifetime choice', () => {
    expect(() => resolveTokenExpiry({}, now)).toThrow(/Choose a token lifetime/);
  });

  it('computes expiry from expiresInDays', () => {
    expect(resolveTokenExpiry({ expiresInDays: 30 }, now)?.toISOString()).toBe(
      '2026-01-31T00:00:00.000Z'
    );
  });

  it('allows non-expiring only when explicitly requested', () => {
    expect(resolveTokenExpiry({ neverExpires: true }, now)).toBeNull();
    expect(() => resolveTokenExpiry({ neverExpires: true, expiresInDays: 5 }, now)).toThrow();
  });

  it('lets a deployment forbid non-expiring tokens and cap lifetimes', () => {
    vi.stubEnv('API_V2_ALLOW_NON_EXPIRING_TOKENS', 'false');
    expect(() => resolveTokenExpiry({ neverExpires: true }, now)).toThrow(/disabled/);
    vi.unstubAllEnvs();
    vi.stubEnv('API_V2_TOKEN_MAX_DAYS', '90');
    expect(() => resolveTokenExpiry({ expiresInDays: 91 }, now)).toThrow(/90 days/);
    expect(() => resolveTokenExpiry({ neverExpires: true }, now)).toThrow();
    expect(resolveTokenExpiry({ expiresInDays: 90 }, now)).not.toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('service account identity', () => {
  it('is decided by the reserved email domain alone, not profile text', () => {
    expect(isServiceAccountIdentity({ email: 'sa_1@serviceaccount.opsknight.local' })).toBe(true);
    expect(isServiceAccountIdentity({ email: 'SA_1@ServiceAccount.OpsKnight.local' })).toBe(true);
    expect(isServiceAccountIdentity({ email: 'human@example.com' })).toBe(false);
    expect(
      isServiceAccountIdentity({
        email: 'evil@serviceaccount.attacker.example',
        // @ts-expect-error profile fields are intentionally ignored
        jobTitle: 'Service Account',
      })
    ).toBe(false);
  });
});
