#!/usr/bin/env node
/**
 * Fails when the live Squire evaluation scored below the stored baseline. The baseline lives in
 * tests/evals/squire/baseline.json and is raised deliberately, by committing a new value, never by a
 * passing run, so a quality regression cannot hide behind a lucky day.
 *
 *   node scripts/check-squire-eval-baseline.cjs [reports/squire-eval.json]
 */
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const reportPath = process.argv[2] || path.join(process.cwd(), 'reports', 'squire-eval.json');
const baselinePath = path.join(process.cwd(), 'tests', 'evals', 'squire', 'baseline.json');

if (!existsSync(reportPath)) {
  console.log(`No evaluation report at ${reportPath}; nothing to compare (the run was skipped).`);
  process.exit(0);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const results = Array.isArray(report) ? report : report.results || [];
if (results.length === 0) {
  console.log('The evaluation report is empty; nothing to compare.');
  process.exit(0);
}
const passed = results.filter(result => result.passed).length;
const rate = passed / results.length;
console.log(`Squire live evaluation: ${passed}/${results.length} passed (${(rate * 100).toFixed(1)}%); baseline ${(baseline.minimumPassRate * 100).toFixed(1)}%.`);
const failed = results.filter(result => !result.passed).map(result => result.id);
if (failed.length) console.log(`Failed cases: ${failed.join(', ')}`);
const required = new Set(baseline.mustPass || []);
const brokenRequired = failed.filter(id => required.has(id));
if (brokenRequired.length) {
  console.error(`Cases that must always pass failed: ${brokenRequired.join(', ')}`);
  process.exit(1);
}
if (rate < baseline.minimumPassRate) {
  console.error('Pass rate is below the stored baseline.');
  process.exit(1);
}
