#!/usr/bin/env node
/**
 * Fails when the live Squire evaluation scored below the stored baseline. The baseline lives in
 * tests/evals/squire/baseline.json and is raised deliberately, by committing a new value, never by a
 * passing run, so a quality regression cannot hide behind a lucky day.
 *
 *   node scripts/check-squire-eval-baseline.cjs [reports/squire-eval.json]
 *     Gates a live report: structural pass rate, cases that must always pass (and must have run), the
 *     per-case token ceiling, and, when the report carries judge grades, the judge's mean score and pass rate.
 *
 *   node scripts/check-squire-eval-baseline.cjs --record-catalogue
 *     Rewrites only `minimumCases` from the case files (how many cases each tier has), so shrinking the
 *     evaluation set fails the unit test until someone commits a smaller number on purpose. Pass rates and
 *     scores are never written by this script.
 */
const { readFileSync, existsSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const baselinePath = path.join(root, 'tests', 'evals', 'squire', 'baseline.json');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

const CATALOGUE = {
  basic: 'tests/evals/squire/basic-cases.ts',
  model: 'tests/evals/squire/model-cases.ts',
  live: 'tests/evals/squire/cases.ts',
};

/** A case starts with its `id` at the start of a line (tool inputs such as `input: { id: … }` never do). */
function countCases(file) {
  return (readFileSync(path.join(root, file), 'utf8').match(/^\s*(?:\{\s*)?id: '[^']+',/gm) || [])
    .length;
}

if (process.argv.includes('--record-catalogue')) {
  const minimumCases = Object.fromEntries(
    Object.entries(CATALOGUE).map(([tier, file]) => [tier, countCases(file)])
  );
  writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, minimumCases }, null, 2)}\n`);
  console.log(`Recorded case counts: ${JSON.stringify(minimumCases)}`);
  process.exit(0);
}

const reportPath =
  process.argv.slice(2).find(arg => !arg.startsWith('--')) ||
  path.join(root, 'reports', 'squire-eval.json');
if (!existsSync(reportPath)) {
  console.log(`No evaluation report at ${reportPath}; nothing to compare (the run was skipped).`);
  process.exit(0);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const results = Array.isArray(report) ? report : report.results || [];
// A skipped run (no key) writes no report at all; a report without results means the run broke.
if (results.length === 0) {
  console.error('The evaluation ran but recorded no results.');
  process.exit(1);
}
const failures = [];
const passed = results.filter(result => result.passed).length;
const rate = passed / results.length;
console.log(
  `Squire live evaluation: ${passed}/${results.length} passed (${(rate * 100).toFixed(1)}%); baseline ${(baseline.minimumPassRate * 100).toFixed(1)}%.`
);
const failed = results.filter(result => !result.passed).map(result => result.id);
if (failed.length) console.log(`Failed cases: ${failed.join(', ')}`);
const ran = new Set(results.map(result => result.id));
const required = baseline.mustPass || [];
const brokenRequired = failed.filter(id => required.includes(id));
if (brokenRequired.length)
  failures.push(`Cases that must always pass failed: ${brokenRequired.join(', ')}`);
// A required case that silently stopped running is as bad as one that failed.
const missingRequired = required.filter(id => !ran.has(id));
if (missingRequired.length)
  failures.push(`Cases that must always pass did not run: ${missingRequired.join(', ')}`);
if (rate < baseline.minimumPassRate) failures.push('Pass rate is below the stored baseline.');

if (baseline.maxTokensPerCase) {
  const over = results.filter(result => (result.tokens || 0) > baseline.maxTokensPerCase);
  if (over.length)
    failures.push(
      `Cases above the ${baseline.maxTokensPerCase}-token ceiling: ${over.map(r => `${r.id} (${r.tokens})`).join(', ')}`
    );
}

const graded = results.filter(result => result.judge && typeof result.judge.score === 'number');
// A report written with the judge on is gated even when no answer could be graded.
if (baseline.judge && (graded.length || report.judgeModel)) {
  const n = Math.max(1, graded.length);
  const mean = graded.reduce((sum, result) => sum + result.judge.score, 0) / n;
  const judgePassRate = graded.filter(result => result.judge.pass).length / n;
  console.log(
    `Judge: ${graded.length}/${results.length} graded, mean ${mean.toFixed(2)} (baseline ${baseline.judge.minimumMeanScore}), pass rate ${(judgePassRate * 100).toFixed(1)}% (baseline ${(baseline.judge.minimumPassRate * 100).toFixed(1)}%).`
  );
  const byCategory = {};
  for (const result of graded) {
    const entry = (byCategory[result.category || 'uncategorised'] ||= { sum: 0, n: 0 });
    entry.sum += result.judge.score;
    entry.n += 1;
  }
  for (const [category, entry] of Object.entries(byCategory))
    console.log(`  ${category}: mean ${(entry.sum / entry.n).toFixed(2)} over ${entry.n}`);
  // An ungradable reply (judge outage, malformed verdict) counts against coverage, never as a pass.
  if (graded.length / results.length < (baseline.judge.minimumGradedRate ?? 0.9))
    failures.push('Too few answers were graded by the judge.');
  if (mean < baseline.judge.minimumMeanScore)
    failures.push('Judge mean score is below the stored baseline.');
  if (judgePassRate < baseline.judge.minimumPassRate)
    failures.push('Judge pass rate is below the stored baseline.');
}

for (const failure of failures) console.error(failure);
process.exit(failures.length ? 1 : 0);
