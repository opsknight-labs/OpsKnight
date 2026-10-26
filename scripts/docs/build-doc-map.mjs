#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { exists, repositoryRoot } from './discovery-lib.mjs';

const versions = JSON.parse(readFileSync(resolve(repositoryRoot, 'docs/versions.json'), 'utf8'));
const currentDocsVersion = versions.currentRelease || 'v2.0.0';

const inventoryFile = resolve(repositoryRoot, `docs/${currentDocsVersion}/capabilities.yaml`);
const inventory = YAML.parse(readFileSync(inventoryFile, 'utf8'));
const failures = [];
const coverage = {};

for (const [id, capability] of Object.entries(inventory.capabilities ?? {})) {
  const groups = ['concepts', 'guides', 'reference', 'tests', 'sources', 'evidence'];
  coverage[id] = Object.fromEntries(groups.map(group => [group, capability[group]?.length ?? 0]));
  for (const [group, required] of Object.entries(capability.required ?? {})) {
    if (required === true && (capability[group]?.length ?? 0) === 0) {
      failures.push(`${id}.${group}: required coverage is empty`);
    }
  }
  for (const group of ['concepts', 'guides', 'reference']) {
    for (const path of capability[group] ?? []) {
      if (!exists(`docs/${currentDocsVersion}/${path}`)) failures.push(`${id}.${group}: missing docs/${currentDocsVersion}/${path}`);
    }
  }
  for (const group of ['tests', 'sources']) {
    for (const path of capability[group] ?? []) {
      if (!exists(path)) failures.push(`${id}.${group}: missing ${path}`);
    }
  }
  for (const path of capability.evidence ?? []) {
    if (!exists(path)) failures.push(`${id}.evidence: missing ${path}`);
    if (path.endsWith('.png') && !exists(path.replace(/\.png$/, '.json'))) {
      failures.push(`${id}.evidence: missing metadata ${path.replace(/\.png$/, '.json')}`);
    }
  }
  if (!['discovered', 'partial', 'documented', 'certified'].includes(capability.status)) {
    failures.push(`${id}.status: unsupported status ${capability.status}`);
  }
}

if (failures.length) {
  console.error(`Documentation capability map failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({ catalog: inventory.catalog, capabilities: coverage }, null, 2));
