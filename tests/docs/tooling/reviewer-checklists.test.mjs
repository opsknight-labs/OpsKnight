import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const checklists = YAML.parse(readFileSync('docs/internal/certification/reviewer-checklists.yaml', 'utf8'));

test('reviewer checklists point to real pages without pretending to certify prose', () => {
  assert.ok(Object.keys(checklists.areas).length > 0);
  for (const [area, checklist] of Object.entries(checklists.areas)) {
    assert.ok(checklist.review.length > 0, `${area}: missing human review prompts`);
    for (const page of checklist.pages) {
      assert.ok(existsSync(`docs/v2.0.0/${page}`), `${area}: missing ${page}`);
    }
  }
});
