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
const rows = [];

const matches = (file, source) => file === source || file.startsWith(`${source.replace(/\/$/, '')}/`);
for (const [id, capability] of Object.entries(inventory.capabilities ?? {})) {
  const productChanges = changed.filter(file => (capability.sources ?? []).some(source => matches(file, source)));
  if (productChanges.length === 0) continue;
  const mappedDocs = ['concepts', 'guides', 'reference']
    .flatMap(group => capability[group] ?? [])
    .map(path => `docs/v2.0.0/${path}`);
  const documentationChanges = changed.filter(file =>
    mappedDocs.includes(file) || file === 'docs/v2.0.0/capabilities.yaml'
  );
  const testChanges = changed.filter(file => (capability.tests ?? []).includes(file));
  rows.push({ id, productChanges, documentationChanges, testChanges, covered: documentationChanges.length > 0 });
}

console.log('## Documentation impact');
if (rows.length === 0) console.log('\nNo mapped product capability changed.');
else {
  console.log('\n| Capability | Product | Documentation | Tests |');
  console.log('| --- | ---: | ---: | ---: |');
  for (const row of rows) {
    console.log(`| ${row.id} | ${row.productChanges.length} | ${row.covered ? '✓' : '✗'} | ${row.testChanges.length || '—'} |`);
  }
}

const uncovered = rows.filter(row => !row.covered);
if (strict && uncovered.length) {
  console.error(`\nMissing documentation impact updates: ${uncovered.map(row => row.id).join(', ')}`);
  process.exit(1);
}

