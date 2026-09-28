import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const contract = JSON.parse(readFileSync('generated/docs-contracts/capacity.json', 'utf8'));

test('capacity documentation remains evidence driven', () => {
  assert.equal(contract.source.path, 'artifacts/load-certification/certification-summary.json');
  assert.equal(contract.topologies.length, 7);
  assert.ok(contract.topologies.every(topology => topology.status === 'NOT CERTIFIED'));
  assert.ok(contract.topologies.every(topology => topology.certifiedCapacity === null));
});
