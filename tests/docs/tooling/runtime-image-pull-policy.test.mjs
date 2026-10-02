import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync('scripts/docs/serve-test-image.sh', 'utf8');

test('pinned documentation runtimes still pull fresh-runner dependencies', () => {
  assert.match(script, /if \[ "\$pull_policy" = "never" \]; then/);

  for (const service of [
    'opsknight-db',
    'mock-slack',
    'mock-teams',
    'mock-jira',
    'mock-smtp',
    'webhook-receiver',
  ]) {
    assert.match(script, new RegExp(`compose pull[^\\n]*\\b${service}\\b`));
  }

  assert.match(script, /compose up -d --pull "\$pull_policy" --wait opsknight-app/);
});
