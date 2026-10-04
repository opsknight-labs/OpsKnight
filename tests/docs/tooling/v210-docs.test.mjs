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
    if (path.includes('/assets/')) assert.deepEqual(readFileSync(copy), readFileSync(path));
  }
});

test('2.1.0 is upcoming without changing the released version', () => {
  const versions = JSON.parse(readFileSync('docs/versions.json', 'utf8'));
  assert.equal(versions.currentRelease, 'v2.0.0');
  assert.equal(versions.upcomingVersion, 'v2.1.0');
  assert.ok(!versions.releasedVersions.includes('v2.1.0'));
});

test('2.1.0 frontmatter and local links resolve', () => {
  execFileSync(process.execPath, ['scripts/docs/check-frontmatter.mjs', 'docs/v2.1.0'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/check-docs-links.cjs', 'docs/v2.1.0'], { stdio: 'pipe' });
});
