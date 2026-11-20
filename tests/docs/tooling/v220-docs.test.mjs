/* eslint-disable security/detect-non-literal-fs-filename -- Paths come only from the fixed repository documentation trees, never user input. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import YAML from 'yaml';

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('2.2.0 retains every 2.1.0 documentation file and asset', () => {
  for (const path of files('docs/v2.1.0')) {
    const copy = path.replace('docs/v2.1.0/', 'docs/v2.2.0/');
    assert.ok(existsSync(copy), `Missing 2.1.0 carry-forward: ${copy}`);
    if (path.includes('/assets/') && !path.endsWith('.yaml')) {
      assert.deepEqual(readFileSync(copy), readFileSync(path));
    }
  }
});

test('2.2.0 is the current release in docs/versions.json', () => {
  const versions = JSON.parse(readFileSync('docs/versions.json', 'utf8'));
  assert.equal(versions.currentRelease, 'v2.2.0');
  assert.ok(versions.releasedVersions.includes('v2.2.0'));
  assert.ok(versions.releasedVersions.includes('v2.1.0'));
});

test('the 2.2.0 catalog is the current catalog and keeps every 2.1.0 capability', () => {
  const current = YAML.parse(readFileSync('docs/v2.2.0/capabilities.yaml', 'utf8'));
  const previous = YAML.parse(readFileSync('docs/v2.1.0/capabilities.yaml', 'utf8'));
  assert.equal(current.catalog, 'current');
  for (const id of Object.keys(previous.capabilities))
    assert.ok(Object.hasOwn(current.capabilities, id), `Dropped capability: ${id}`);
  assert.ok(current.capabilities.mcp_assistants, 'mcp_assistants is mapped');
});

test('2.2.0 pages do not link back into the 2.1.0 tree', () => {
  for (const path of files('docs/v2.2.0').filter(file => file.endsWith('.md')))
    assert.doesNotMatch(readFileSync(path, 'utf8'), /\]\([^)]*v2\.1\.0\//, path);
});

test('2.2.0 frontmatter and local links resolve', () => {
  execFileSync(process.execPath, ['scripts/docs/check-frontmatter.mjs', 'docs/v2.2.0'], {
    stdio: 'pipe',
  });
  execFileSync(process.execPath, ['scripts/check-docs-links.cjs', 'docs/v2.2.0'], {
    stdio: 'pipe',
  });
});

test('the 2.2.0 upgrade guide covers every release upgrade note', () => {
  const guide = readFileSync('docs/v2.2.0/operate/upgrades/upgrade-to-2.2.0.md', 'utf8');
  for (const phrase of [
    'legacyStoredKeyAccepted',
    'Outgoing webhooks',
    'open incidents',
    '60 minutes',
    'own teams',
    'Content-Length',
    'Roll back',
  ])
    assert.ok(guide.includes(phrase), `Upgrade guide is missing: ${phrase}`);
});
