import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const oidc = readFileSync('docs/v2.0.0/guides/identity/configure-oidc.md', 'utf8');
const scim = readFileSync('docs/v2.0.0/guides/identity/configure-scim.md', 'utf8');

test('OIDC guide covers every supported provider and session-policy control', () => {
  for (const required of [
    'Microsoft Entra ID',
    'Google Workspace',
    'Okta',
    'Auth0',
    'Generic OIDC and Keycloak',
    'AUTH_SSO_SESSION_MAX_AGE_SECONDS',
    'AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS',
    'AUTH_SSO_REAUTH_AFTER_SECONDS',
    'AUTH_SSO_SESSION_UPDATE_AGE_SECONDS',
    'Existing users and first-time linking',
    'Enforce SSO-only login',
    'AUTH_LOCAL_LOGIN_ENABLED=false',
    'AUTH_BREAK_GLASS_ENABLED=true',
    'Runtime availability and performance behavior',
    'JIT provisioning',
    'Change the issuer, client registration, or secret',
  ]) assert.ok(oidc.includes(required), `OIDC guide must cover ${required}`);
});

test('SCIM guide covers the complete implemented lifecycle', () => {
  for (const required of [
    'Discovery endpoints',
    'Users contract',
    'Groups contract',
    'Configure Microsoft Entra',
    'Configure Okta',
    'Group deletion is destructive',
    'Rotate or revoke the token',
    'SCIM_BEARER_TOKEN',
    'externalId',
    'User deletion and roles',
  ]) assert.ok(scim.includes(required), `SCIM guide must cover ${required}`);
});
