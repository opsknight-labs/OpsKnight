import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const checklists = YAML.parse(readFileSync('docs/internal/certification/reviewer-checklists.yaml', 'utf8'));

test('reviewer checklists use explicit, evidence-backed sign-off state', () => {
  assert.equal(checklists.schemaVersion, 2);
  assert.ok(Object.keys(checklists.areas).length > 0);
  for (const [area, checklist] of Object.entries(checklists.areas)) {
    assert.ok(checklist.review.length > 0, `${area}: missing human review prompts`);
    for (const page of checklist.pages) {
      assert.ok(existsSync(`docs/v2.0.0/${page}`), `${area}: missing ${page}`);
    }
    const signoff = checklist.signoff;
    assert.ok(signoff, `${area}: missing signoff record`);
    assert.ok(['pending', 'passed', 'failed'].includes(signoff.status), `${area}: invalid signoff status`);
    if (signoff.status === 'pending') {
      assert.equal(signoff.reviewer, null, `${area}: pending review must not name a reviewer`);
      assert.equal(signoff.reviewedAt, null, `${area}: pending review must not have a date`);
      assert.equal(signoff.sourceRevision, null, `${area}: pending review must not claim a revision`);
      assert.deepEqual(signoff.evidence, [], `${area}: pending review must not claim evidence`);
      continue;
    }
    assert.match(signoff.reviewer, /\S/, `${area}: completed review needs reviewer`);
    assert.match(signoff.reviewedAt, /^\d{4}-\d{2}-\d{2}T/, `${area}: completed review needs ISO date`);
    assert.match(signoff.sourceRevision, /^[0-9a-f]{40}$/, `${area}: completed review needs full source revision`);
    assert.ok(signoff.evidence?.length > 0, `${area}: completed review needs evidence`);
    for (const evidence of signoff.evidence) {
      assert.ok(existsSync(evidence), `${area}: missing signoff evidence ${evidence}`);
    }
  }
});
