import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

test('all task docs pass the implementation-backed product-surface guard', () => {
  execFileSync('node', ['scripts/docs/check-surface-parity.mjs'], { stdio: 'pipe' });
  const registry = YAML.parse(readFileSync('docs/internal/product-surface-contracts.yaml', 'utf8'));
  const byId = new Map(registry.contracts.map(contract => [contract.id, contract]));

  assert.deepEqual(byId.get('incident.escalate').surfaces, {
    web: 'NOT_SUPPORTED', mobile: 'NOT_SUPPORTED', slack: 'NOT_SUPPORTED',
    teams: 'PARTIAL', api: 'NOT_SUPPORTED', automatic: 'SUPPORTED',
  });
  assert.deepEqual(byId.get('incident.reopen').surfaces, {
    web: 'NOT_SUPPORTED', mobile: 'NOT_SUPPORTED', slack: 'NOT_SUPPORTED',
    teams: 'NOT_SUPPORTED', api: 'API_ONLY', automatic: 'AUTOMATIC_ONLY',
  });

  const report = readFileSync('generated/docs-certification/surface-parity-report.md', 'utf8');
  assert.match(report, /Task-oriented pages scanned: 200/);
  assert.match(report, /Forbidden surface-pattern violations remaining: 0/);
});
