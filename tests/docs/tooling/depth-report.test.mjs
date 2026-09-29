import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const report = JSON.parse(readFileSync('generated/docs-certification/depth.json', 'utf8'));
test('documentation depth gates have no missing or partial coverage', () => {
  assert.equal(report.publicFeatures, report.mapped);
  assert.equal(report.semanticCoverage.partial, 0);
  assert.equal(report.semanticCoverage.missing, 0);
  assert.equal(report.v15Parity.unclassified, 0);
  assert.equal(report.uiRoutes.public, report.uiRoutes.documented);
  assert.equal(report.configuration.discovered, report.configuration.documented);
});
