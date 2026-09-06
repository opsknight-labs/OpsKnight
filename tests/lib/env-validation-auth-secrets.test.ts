import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateProductionEnv } from '@/lib/env-validation';

function configureValidProductionEnv() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@example.invalid:5432/opsknight');
  vi.stubEnv('NEXTAUTH_URL', 'https://ops.example.com');
  vi.stubEnv('NEXTAUTH_SECRET', 'session-secret-for-production-tests');
  vi.stubEnv('API_KEY_SECRET', 'independent-api-key-secret-for-production-tests');
  vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
  vi.stubEnv('SKIP_ENV_VALIDATION', '');
}

describe('production authentication secret validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows API_KEY_SECRET to be omitted for domain-separated fallback compatibility', () => {
    configureValidProductionEnv();
    vi.stubEnv('API_KEY_SECRET', '');

    expect(() => validateProductionEnv()).not.toThrow();
  });

  it('rejects reuse of NEXTAUTH_SECRET for API-key hashing', () => {
    configureValidProductionEnv();
    vi.stubEnv('API_KEY_SECRET', 'session-secret-for-production-tests');

    expect(() => validateProductionEnv()).toThrow(/must be different from NEXTAUTH_SECRET/);
  });

  it('does not treat SKIP_ENV_VALIDATION=false as an enabled bypass', () => {
    configureValidProductionEnv();
    vi.stubEnv('SKIP_ENV_VALIDATION', 'false');
    vi.stubEnv('DATABASE_URL', '');

    expect(() => validateProductionEnv()).toThrow(/DATABASE_URL/);
  });

  it('honors an explicitly enabled production validation bypass', () => {
    configureValidProductionEnv();
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('DATABASE_URL', '');

    expect(() => validateProductionEnv()).not.toThrow();
  });

  it('accepts independent session, API-key, and encryption secrets', () => {
    configureValidProductionEnv();

    expect(() => validateProductionEnv()).not.toThrow();
  });
});
