#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';

const release = process.argv.includes('--release');
const checklist = YAML.parse(readFileSync('docs/internal/certification/reviewer-checklists.yaml', 'utf8'));
if (checklist.schemaVersion !== 2) throw new Error('Reviewer checklist schemaVersion must be 2.');

const failures = [];
const summary = { total: 0, pending: 0, passed: 0, failed: 0 };
for (const [area, entry] of Object.entries(checklist.areas ?? {})) {
  summary.total += 1;
  const signoff = entry.signoff ?? {};
  if (!['pending', 'passed', 'failed'].includes(signoff.status)) {
    failures.push(`${area}: invalid or missing signoff status`);
    continue;
  }
  summary[signoff.status] += 1;
  if (signoff.status === 'pending') {
    if (release) failures.push(`${area}: release certification requires completed signoff`);
    continue;
  }
  if (!signoff.reviewer?.trim()) failures.push(`${area}: missing reviewer`);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(signoff.reviewedAt ?? '')) failures.push(`${area}: missing ISO reviewedAt`);
  if (!/^[0-9a-f]{40}$/.test(signoff.sourceRevision ?? '')) failures.push(`${area}: missing full sourceRevision`);
  if (!signoff.evidence?.length) failures.push(`${area}: missing signoff evidence`);
  for (const evidence of signoff.evidence ?? []) {
    if (!existsSync(evidence)) failures.push(`${area}: missing evidence ${evidence}`);
  }
  if (release && signoff.status !== 'passed') failures.push(`${area}: release signoff is ${signoff.status}`);
}

if (failures.length) {
  console.error(`Reviewer signoff contract failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log(`Reviewer signoffs: ${summary.passed} passed, ${summary.failed} failed, ${summary.pending} pending (${summary.total} total).`);
