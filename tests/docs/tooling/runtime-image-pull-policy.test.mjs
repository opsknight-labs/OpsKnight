import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync('scripts/docs/serve-test-image.sh', 'utf8');
const workflow = readFileSync('.github/workflows/docs-links.yml', 'utf8');
const playwrightConfig = readFileSync('playwright.docs.config.ts', 'utf8');
const evidenceHelper = readFileSync('tests/docs/helpers/evidence.ts', 'utf8');

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

test('certification uses an immutable local image ID and a shared API-key secret', () => {
  assert.equal((workflow.match(/DOCS_OPSKNIGHT_IMAGE=\$\(docker image inspect --format '\{\{\.Id\}\}'/g) ?? []).length, 2);
  assert.match(evidenceHelper, /\^sha256:\[0-9a-f\]\{64\}\$/);
  assert.match(playwrightConfig, /process\.env\.API_KEY_SECRET \|\|= 'docs-runtime-only-api-key-secret'/);
});
