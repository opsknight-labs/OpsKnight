#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { repositoryRoot } from './discovery-lib.mjs';

const argument = flag => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
};
const base = argument('--base') || process.env.DOCS_IMPACT_BASE || 'HEAD~1';
const strict = process.argv.includes('--strict') || process.env.DOCS_IMPACT_STRICT === 'true';
const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean);
const inventory = YAML.parse(readFileSync(resolve(repositoryRoot, 'docs/v2.0.0/capabilities.yaml'), 'utf8'));
const currentGraph = JSON.parse(readFileSync(resolve(repositoryRoot, 'generated/docs-contracts/current.json'), 'utf8'));
let baseGraph = { contracts: [] };
try {
  baseGraph = JSON.parse(execFileSync('git', ['show', `${base}:generated/docs-contracts/current.json`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }));
} catch {
  // A branch introducing the contract graph treats every current node as new.
}
const baseNodes = new Map((baseGraph.contracts ?? []).map(node => [node.id, node]));
const changedContracts = (currentGraph.contracts ?? []).filter(node =>
  JSON.stringify(baseNodes.get(node.id) ?? null) !== JSON.stringify(node)
);
const rows = [];

const matches = (file, source) => file === source || file.startsWith(`${source.replace(/\/$/, '')}/`);
for (const [id, capability] of Object.entries(inventory.capabilities ?? {})) {
  const productChanges = changed.filter(file => (capability.sources ?? []).some(source => matches(file, source)));
  if (productChanges.length === 0) continue;
  const mappedDocs = ['concepts', 'guides', 'reference']
    .flatMap(group => capability[group] ?? [])
    .map(path => `docs/v2.0.0/${path}`);
  const documentationChanges = changed.filter(file =>
    mappedDocs.includes(file)
  );
  const testChanges = changed.filter(file => (capability.tests ?? []).includes(file));
  const contractChanges = changedContracts.filter(node =>
    (node.sources ?? []).some(file => (capability.sources ?? []).some(source => matches(file, source)))
  );
  rows.push({
    id,
    productChanges,
    contractChanges,
    documentationChanges,
    testChanges,
    covered: contractChanges.length === 0 || documentationChanges.length > 0,
  });
}

console.log('## Documentation impact');
if (rows.length === 0) console.log('\nNo mapped product capability changed.');
else {
  console.log('\n| Capability | Product files | Public contracts | Documentation | Tests |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const row of rows) {
    console.log(`| ${row.id} | ${row.productChanges.length} | ${row.contractChanges.length || 'unchanged'} | ${row.covered ? '✓' : '✗'} | ${row.testChanges.length || '—'} |`);
  }
}

const uncovered = rows.filter(row => !row.covered);
if (strict && uncovered.length) {
  console.error(`\nPublic contract changes without mapped documentation updates: ${uncovered.map(row => row.id).join(', ')}`);
  process.exit(1);
}
