import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('enterprise identity documentation', () => {
  it('keeps the v1.5 OIDC and SCIM guides versioned with the implementation', () => {
    expect(existsSync('docs/v1.5/security/oidc-setup.md')).toBe(true);
    expect(existsSync('docs/v1.5/security/scim-provisioning.md')).toBe(true);
  });

  it('documents the provider-specific OIDC security boundaries', () => {
    const oidc = readFileSync('docs/v1.5/security/oidc-setup.md', 'utf8');
    expect(oidc).toContain('issuer plus the OIDC subject');
    expect(oidc).toContain('Microsoft Entra ID');
    expect(oidc).toContain('signed `hd` claim');
    expect(oidc).toContain('signed `org_id`');
    expect(oidc).toContain('one OIDC provider configuration per workspace');
  });

  it('documents SSO-only, break-glass, session, and SCIM operator controls', () => {
    const auth = readFileSync('docs/v1.5/administration/authentication.md', 'utf8');
    const config = readFileSync('docs/v1.5/getting-started/configuration.md', 'utf8');
    const scim = readFileSync('docs/v1.5/security/scim-provisioning.md', 'utf8');

    expect(auth).toContain('AUTH_LOCAL_LOGIN_ENABLED=false');
    expect(auth).toContain('AUTH_BREAK_GLASS_EMAIL');
    expect(config).toContain('AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS');
    expect(config).toContain('AUTH_SSO_REAUTH_AFTER_SECONDS');
    expect(config).toContain('SCIM_BEARER_TOKEN');
    expect(scim).toContain('SCIM 2.0 **Users**');
    expect(scim).toContain('does **not** physically erase');
  });
});
