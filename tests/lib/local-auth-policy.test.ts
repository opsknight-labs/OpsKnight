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
    expect(getEnterpriseSessionPolicy()).toEqual({
      maximumAgeSeconds: 43200,
      updateAgeSeconds: 3600,
    });
    process.env.AUTH_SSO_SESSION_MAX_AGE_SECONDS = '999999999';
    expect(getEnterpriseSessionPolicy().maximumAgeSeconds).toBe(43200);
  });
});
