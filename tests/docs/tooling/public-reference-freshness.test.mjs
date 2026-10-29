/* eslint-disable security/detect-non-literal-fs-filename */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const versions = JSON.parse(readFileSync('docs/versions.json', 'utf8'));
const currentDocsVersion = versions.currentRelease || 'v2.0.0';

const generatedBackedReferences = [
  'reference/features.md',
  'reference/configuration/README.md',
  'reference/api/README.md',
];

test('published generated-backed references match current discovery output', () => {
  for (const path of generatedBackedReferences) {
    const published = readFileSync(`docs/${currentDocsVersion}/${path}`, 'utf8');
    const generated = readFileSync(`generated/docs-reference/${path}`, 'utf8');
    assert.equal(
      published,
      generated,
      `${path}: public reference is stale; regenerate and publish it`
    );
  }
});
