import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const escalate = readFileSync('docs/v2.0.0/guides/incidents/escalate.md', 'utf8');
const resolve = readFileSync('docs/v2.0.0/guides/incidents/resolve.md', 'utf8');
const endToEnd = readFileSync('docs/v2.0.0/guides/incidents/respond-to-an-incident.md', 'utf8');

test('incident guides preserve the implemented manual-action boundaries', () => {
  for (const page of [escalate, endToEnd]) {
    assert.match(page, /Microsoft Teams/);
    assert.match(page, /Web[^\n]*(?:no manual|not from)/i);
    assert.match(page, /Slack[^\n]*(?:do not|not from)/i);
  }

  assert.match(resolve, /Web incident page has no manual \*\*Reopen\*\* action/);
  assert.match(resolve, /PATCH \/api\/incidents\/\{id\}/);
  assert.doesNotMatch(resolve, /Select \*\*Reopen\*\*/);
});
