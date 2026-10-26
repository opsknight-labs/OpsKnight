/* eslint-disable security/detect-non-literal-fs-filename -- Paths come only from the fixed repository documentation trees, never user input. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('2.1.0 retains every baseline documentation file and asset', () => {
  for (const path of files('docs/v2.0.0')) {
    const copy = path.replace('docs/v2.0.0/', 'docs/v2.1.0/');
    assert.ok(existsSync(copy), `Missing baseline copy: ${copy}`);
    if (path.includes('/assets/') && !path.endsWith('.yaml')) {
      assert.deepEqual(readFileSync(copy), readFileSync(path));
    }
  }
});

test('2.1.0 is released in docs/versions.json', () => {
  const versions = JSON.parse(readFileSync('docs/versions.json', 'utf8'));
  assert.equal(versions.currentRelease, 'v2.1.0');
  assert.equal(versions.upcomingVersion, 'v2.2.0');
  assert.ok(versions.releasedVersions.includes('v2.1.0'));
});

test('2.1.0 frontmatter and local links resolve', () => {
  execFileSync(process.execPath, ['scripts/docs/check-frontmatter.mjs', 'docs/v2.1.0'], {
    stdio: 'pipe',
  });
  execFileSync(process.execPath, ['scripts/check-docs-links.cjs', 'docs/v2.1.0'], {
    stdio: 'pipe',
  });
});

test('2.1 identity policy guides describe the implemented migration and activation boundary', () => {
  const guide = readFileSync('docs/v2.1.0/guides/identity/authentication-modes.md', 'utf8');
  for (const phrase of [
    'Password Only',
    'SSO Optional',
    'SSO Required',
    'five-minute',
    'once',
    'PostgreSQL',
    'one-hour',
    '15-minute',
    'Rollback',
    'restricted recovery',
  ]) {
    assert.ok(
      guide.toLowerCase().includes(phrase.toLowerCase()),
      `Missing policy procedure: ${phrase}`
    );
  }
  assert.match(guide, /two active, independently held hardware-key emergency identities/);
  assert.match(guide, /never creates an ordinary administrator session/);
  for (const name of [
    'migrate-admin-to-sso',
    'configure-emergency-access',
    'test-and-enforce-sso',
    'rotate-oidc-credentials',
    'sso-lockout-recovery',
  ])
    assert.ok(existsSync(`docs/v2.1.0/guides/identity/${name}.md`));
  const oidc = readFileSync('docs/v2.1.0/guides/identity/configure-oidc.md', 'utf8');
  assert.match(oidc, /SSO \/ Authentication/);
  assert.ok(!oidc.includes('Local credential login is controlled by `AUTH_LOCAL_LOGIN_ENABLED`'));
  for (const provider of ['Microsoft Entra', 'Google', 'Okta', 'Auth0', 'Keycloak']) {
    assert.ok(oidc.includes(provider), `Lost provider instructions: ${provider}`);
  }
  assert.ok(
    readFileSync('docs/v2.1.0/guides/identity/README.md', 'utf8').includes('authentication-modes')
  );
});
