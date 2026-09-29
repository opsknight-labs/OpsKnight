#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';

const release = process.argv.includes('--release');
const inventory = YAML.parse(readFileSync('docs/internal/certification/v1.5-topic-inventory.yaml', 'utf8'));
const review = YAML.parse(readFileSync('docs/internal/certification/v1.5-to-v2-parity.yaml', 'utf8'));
const allowed = new Set(review.allowedStatuses ?? []);
const inventoryIds = new Set((inventory.topics ?? []).map(item => item.id));
const failures = [];
const seen = new Set();

for (const item of review.dispositions ?? []) {
  if (!inventoryIds.has(item.id)) failures.push(`${item.id}: not present in inventory`);
  if (seen.has(item.id)) failures.push(`${item.id}: duplicate disposition`);
  seen.add(item.id);
  if (!allowed.has(item.status)) failures.push(`${item.id}: invalid status ${item.status}`);
  if (!item.reviewer?.trim()) failures.push(`${item.id}: missing human reviewer`);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(item.reviewedAt ?? '')) failures.push(`${item.id}: missing ISO reviewedAt`);
  if (!/^[0-9a-f]{40}$/.test(item.sourceRevision ?? '')) failures.push(`${item.id}: missing full sourceRevision`);
  if (!item.evidence?.length) failures.push(`${item.id}: missing current evidence`);
  for (const evidence of item.evidence ?? []) {
    if (!existsSync(evidence)) failures.push(`${item.id}: missing evidence ${evidence}`);
  }
  if (['PORT', 'UPDATED'].includes(item.status)) {
    if (!item.destination) failures.push(`${item.id}: missing v2 destination`);
    else if (!existsSync(item.destination)) failures.push(`${item.id}: missing destination ${item.destination}`);
  } else if (!item.rationale?.trim()) {
    failures.push(`${item.id}: ${item.status} requires rationale`);
  }
}

const unresolved = inventoryIds.size - seen.size;
if (release && unresolved !== 0) failures.push(`release certification has ${unresolved} unresolved v1.5 topics`);
if (failures.length) {
  console.error(`v1.5 parity contract failed (${failures.length}):`);
  failures.slice(0, 100).forEach(failure => console.error(`  - ${failure}`));
  if (failures.length > 100) console.error(`  - ... ${failures.length - 100} more`);
  process.exit(1);
}
console.log(`v1.5 parity: ${seen.size}/${inventoryIds.size} manually reviewed; ${unresolved} unresolved.`);
