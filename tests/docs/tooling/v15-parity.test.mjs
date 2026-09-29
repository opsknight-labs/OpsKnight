import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const inventory = YAML.parse(readFileSync('docs/internal/certification/v1.5-topic-inventory.yaml', 'utf8'));
const review = YAML.parse(readFileSync('docs/internal/certification/v1.5-to-v2-parity.yaml', 'utf8'));
const allowed = new Set(['PORT', 'UPDATED', 'NO_LONGER_APPLICABLE', 'INTERNAL']);

test('generated v1.5 inventory is complete and manual dispositions are evidenced', () => {
  assert.ok(inventory.topics.length > 0);
  const inventoryIds = new Set(inventory.topics.map(topic => topic.id));
  assert.equal(inventoryIds.size, inventory.topics.length);
  assert.equal(new Set(review.dispositions.map(item => item.id)).size, review.dispositions.length);
  for (const item of review.dispositions) {
    assert.ok(inventoryIds.has(item.id), `${item.id}: not present in generated inventory`);
    assert.ok(allowed.has(item.status), `${item.id}: invalid status`);
    assert.ok(item.evidence?.length, `${item.id}: manual review requires evidence`);
    if (['PORT', 'UPDATED'].includes(item.status)) {
      assert.ok(item.destination, `${item.id}: missing v2 destination`);
      assert.ok(existsSync(item.destination), `${item.id}: missing destination ${item.destination}`);
    }
    for (const evidence of item.evidence) assert.ok(existsSync(evidence), `${item.id}: missing evidence ${evidence}`);
  }
});
