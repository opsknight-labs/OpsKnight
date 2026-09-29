import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const ledger = YAML.parse(readFileSync('docs/internal/certification/v1.5-to-v2-parity.yaml', 'utf8'));
const allowed = new Set(['PORTED', 'CHANGED', 'REMOVED', 'INTERNAL', 'DEPRECATED', 'NOT_APPLICABLE']);

test('every v1.5 topic has an evidenced migration disposition', () => {
  assert.ok(ledger.topics.length > 0);
  assert.equal(new Set(ledger.topics.map(topic => topic.id)).size, ledger.topics.length);
  for (const topic of ledger.topics) {
    assert.ok(allowed.has(topic.status), `${topic.id}: invalid status`);
    assert.ok(existsSync(topic.source), `${topic.id}: missing source`);
    if (['PORTED', 'CHANGED'].includes(topic.status)) assert.ok(existsSync(topic.destination), `${topic.id}: missing destination`);
    if (topic.status === 'REMOVED') assert.ok(topic.evidence?.length, `${topic.id}: REMOVED requires evidence`);
    for (const evidence of topic.evidence ?? []) assert.ok(existsSync(evidence), `${topic.id}: missing evidence ${evidence}`);
  }
});
