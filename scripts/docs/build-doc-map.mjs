#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { exists, repositoryRoot } from './discovery-lib.mjs';

const inventoryFile = resolve(repositoryRoot, 'docs/v2.0.0/capabilities.yaml');
const inventory = YAML.parse(readFileSync(inventoryFile, 'utf8'));
const failures = [];
const coverage = {};

for (const [id, capability] of Object.entries(inventory.capabilities ?? {})) {
  const groups = ['concepts', 'guides', 'reference', 'tests', 'sources', 'evidence'];
  coverage[id] = Object.fromEntries(groups.map(group => [group, capability[group]?.length ?? 0]));
  for (const group of ['concepts', 'guides', 'reference']) {
    for (const path of capability[group] ?? []) {
      if (!exists(`docs/v2.0.0/${path}`)) failures.push(`${id}.${group}: missing docs/v2.0.0/${path}`);
    }
  }
  for (const group of ['tests', 'sources']) {
    for (const path of capability[group] ?? []) {
      if (!exists(path)) failures.push(`${id}.${group}: missing ${path}`);
    }
  }
}

if (failures.length) {
  console.error(`Documentation capability map failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({ version: inventory.version, capabilities: coverage }, null, 2));
