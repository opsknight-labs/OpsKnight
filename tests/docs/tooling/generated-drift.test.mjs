import assert from 'node:assert/strict';
import test from 'node:test';
import {
  revisionOnlyDrift,
  withoutCommitBoundMarkdown,
} from '../../../scripts/docs/check-generated-drift.mjs';

test('current discovery and contract artifacts differ from HEAD only by revision metadata', () => {
  assert.equal(revisionOnlyDrift('generated/docs-discovery/current.json'), true);
  assert.equal(revisionOnlyDrift('generated/docs-contracts/current.json'), true);
});

test('generated Markdown treats only the commit-bound verified_at date as provenance', () => {
  const page = (date, body) => `---\nverification:\n  verified_at: ${date}\n---\n${body}\n`;
  assert.equal(
    withoutCommitBoundMarkdown(page('2026-10-02', 'Total: 1')),
    withoutCommitBoundMarkdown(page('2026-10-03', 'Total: 1'))
  );
  assert.notEqual(
    withoutCommitBoundMarkdown(page('2026-10-02', 'Total: 1')),
    withoutCommitBoundMarkdown(page('2026-10-02', 'Total: 2'))
  );
});
