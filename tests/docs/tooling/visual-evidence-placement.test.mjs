import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { filesUnder } from '../../../scripts/docs/discovery-lib.mjs';

const pages = filesUnder('docs/v2.0.0', file => file.endsWith('.md'));

test('a page does not reuse one screenshot for different instructions', () => {
  for (const page of pages) {
    const source = readFileSync(page, 'utf8');
    const images = [...source.matchAll(/!\[[^\]]*]\((\/docs\/v2\.0\.0\/assets\/[^)]+)\)/g)].map(
      match => match[1]
    );
    assert.equal(new Set(images).size, images.length, `${page}: repeats the same screenshot`);
  }
});

test('notification provider screenshot is not presented as routing or operations evidence', () => {
  const owners = pages.filter(page =>
    readFileSync(page, 'utf8').includes('/docs/v2.0.0/assets/notification-settings.png')
  );
  assert.deepEqual(owners, ['docs/v2.0.0/guides/notifications/configure-provider.md']);
});
