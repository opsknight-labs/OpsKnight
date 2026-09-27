#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { exists, filesUnder, readRepositoryFile, repositoryRoot } from './discovery-lib.mjs';

const inventory = YAML.parse(readFileSync(resolve(repositoryRoot, 'docs/v2.0.0/capabilities.yaml'), 'utf8'));
const failures = [];
for (const [id, capability] of Object.entries(inventory.capabilities ?? {})) {
  for (const evidence of capability.evidence ?? []) {
    if (!exists(evidence)) failures.push(`${id}: missing evidence ${evidence}`);
    const metadata = evidence.replace(/\.png$/, '.json');
    if (evidence.endsWith('.png') && !exists(metadata)) failures.push(`${id}: missing metadata ${metadata}`);
  }
}
if (exists('generated/docs-evidence')) {
  for (const file of filesUnder('generated/docs-evidence', path => path.endsWith('.json'))) {
    let metadata;
    try { metadata = JSON.parse(readRepositoryFile(file)); }
    catch (error) { failures.push(`${file}: invalid JSON (${error.message})`); continue; }
    for (const field of ['version', 'commit', 'route', 'journey', 'browser', 'viewport']) if (!metadata[field]) failures.push(`${file}: missing ${field}`);
  }
}
if (failures.length) {
  console.error(`Documentation evidence failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('Documentation evidence contract passed.');
