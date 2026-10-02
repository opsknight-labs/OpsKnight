import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const generatedBackedReferences = [
  'reference/features.md',
  'reference/configuration/README.md',
  'reference/api/README.md',
];

test('published generated-backed references match current discovery output', () => {
  for (const path of generatedBackedReferences) {
    const published = readFileSync(`docs/v2.0.0/${path}`, 'utf8');
    const generated = readFileSync(`generated/docs-reference/${path}`, 'utf8');
    assert.equal(published, generated, `${path}: public reference is stale; regenerate and publish it`);
  }
});
