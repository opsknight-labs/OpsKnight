import assert from 'node:assert/strict';
import test from 'node:test';
import { revisionOnlyDrift } from '../../../scripts/docs/check-generated-drift.mjs';

test('current discovery and contract artifacts differ from HEAD only by revision metadata', () => {
  assert.equal(revisionOnlyDrift('generated/docs-discovery/current.json'), true);
  assert.equal(revisionOnlyDrift('generated/docs-contracts/current.json'), true);
});
