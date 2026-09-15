import { afterEach, describe, expect, it } from 'vitest';
import {
  getEnterpriseSessionPolicy,
  getLocalAuthPolicy,
  isLocalCredentialAllowed,
} from '@/lib/local-auth-policy';

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe('enterprise local authentication policy', () => {
  it('removes credential auth when local login and break glass are disabled', () => {
    process.env.AUTH_LOCAL_LOGIN_ENABLED = 'false';
    process.env.AUTH_BREAK_GLASS_ENABLED = 'false';
    expect(getLocalAuthPolicy().enabled).toBe(false);
    expect(isLocalCredentialAllowed('admin@example.com')).toBe(false);
  });

  it('limits break-glass authentication to the configured account', () => {
    process.env.AUTH_LOCAL_LOGIN_ENABLED = 'false';
    process.env.AUTH_BREAK_GLASS_ENABLED = 'true';
    process.env.AUTH_BREAK_GLASS_EMAIL = 'Emergency@Example.com';
    expect(isLocalCredentialAllowed('emergency@example.com')).toBe(true);
    expect(isLocalCredentialAllowed('other@example.com')).toBe(false);
  });

  it('bounds configurable SSO session lifetimes', () => {
    process.env.AUTH_SSO_SESSION_MAX_AGE_SECONDS = '43200';
    process.env.AUTH_SSO_SESSION_UPDATE_AGE_SECONDS = '3600';
    process.env.AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS = '14400';
    process.env.AUTH_SSO_REAUTH_AFTER_SECONDS = '43200';
    expect(getEnterpriseSessionPolicy()).toEqual({
      maximumAgeSeconds: 43200,
      updateAgeSeconds: 3600,
      idleTimeoutSeconds: 14400,
      reauthenticateAfterSeconds: 43200,
    });
    process.env.AUTH_SSO_SESSION_MAX_AGE_SECONDS = '999999999';
    process.env.AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS = '10';
    process.env.AUTH_SSO_REAUTH_AFTER_SECONDS = '999999999';
    expect(getEnterpriseSessionPolicy().maximumAgeSeconds).toBe(43200);
    expect(getEnterpriseSessionPolicy().idleTimeoutSeconds).toBe(14400);
    expect(getEnterpriseSessionPolicy().reauthenticateAfterSeconds).toBe(43200);
  });

  it('supports dynamic database-backed session policy overrides with clamping', () => {
    // Custom valid overrides
    const custom = getEnterpriseSessionPolicy({
      sessionMaxAgeSeconds: 28800, // 8 hours
      sessionIdleTimeoutSeconds: 7200, // 2 hours
    });
    expect(custom.maximumAgeSeconds).toBe(28800);
    expect(custom.idleTimeoutSeconds).toBe(7200);
    expect(custom.reauthenticateAfterSeconds).toBe(28800);

    // Clamping when idle timeout exceeds maximum age
    const clamped = getEnterpriseSessionPolicy({
      sessionMaxAgeSeconds: 3600, // 1 hour
      sessionIdleTimeoutSeconds: 7200, // 2 hours -> clamped to 1 hour
    });
    expect(clamped.maximumAgeSeconds).toBe(3600);
    expect(clamped.idleTimeoutSeconds).toBe(3600);

    // Out of bounds values fallback to env / system defaults
    const outOfBounds = getEnterpriseSessionPolicy({
      sessionMaxAgeSeconds: 100, // below 900
      sessionIdleTimeoutSeconds: 50, // below 300
    });
    expect(outOfBounds.maximumAgeSeconds).toBe(43200);
    expect(outOfBounds.idleTimeoutSeconds).toBe(14400);

    // Null overrides gracefully inherit defaults
    const nullOverrides = getEnterpriseSessionPolicy({
      sessionMaxAgeSeconds: null,
      sessionIdleTimeoutSeconds: null,
    });
    expect(nullOverrides.maximumAgeSeconds).toBe(43200);
    expect(nullOverrides.idleTimeoutSeconds).toBe(14400);
  });
});
