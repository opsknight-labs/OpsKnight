import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { test } from 'node:test';

const documentationRoot = resolve('docs/v2.0.0');

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  });
}

test('reader documentation has one source page per rendered URL', () => {
  const files = new Set(markdownFiles(documentationRoot).map(file => relative(documentationRoot, file)));
  const collisions = [...files]
    .filter(file => file.endsWith('/README.md'))
    .map(file => file.slice(0, -'/README.md'.length) + '.md')
    .filter(file => files.has(file));

  assert.deepEqual(collisions, [], `duplicate documentation URL slugs: ${collisions.join(', ')}`);
});
