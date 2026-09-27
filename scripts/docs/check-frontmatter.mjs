#!/usr/bin/env node
import YAML from 'yaml';
import { filesUnder, readRepositoryFile } from './discovery-lib.mjs';

const allowedTypes = new Set(['tutorial', 'concept', 'how-to', 'reference', 'troubleshooting', 'deployment', 'integration', 'developer']);
const allowedAudiences = new Set(['responder', 'administrator', 'operator', 'developer', 'viewer']);
const failures = [];

for (const file of filesUnder('docs/v2.0.0', path => path.endsWith('.md'))) {
  const source = readRepositoryFile(file);
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    failures.push(`${file}: missing YAML frontmatter`);
    continue;
  }
  let metadata;
  try { metadata = YAML.parse(match[1]); }
  catch (error) { failures.push(`${file}: invalid YAML (${error.message})`); continue; }
  for (const field of ['title', 'description', 'type', 'product_area', 'audience', 'verification']) {
    if (metadata[field] === undefined || metadata[field] === '') failures.push(`${file}: missing ${field}`);
  }
  if (!allowedTypes.has(metadata.type)) failures.push(`${file}: unsupported type ${metadata.type}`);
  if (!Array.isArray(metadata.audience) || metadata.audience.length === 0) failures.push(`${file}: audience must be a non-empty array`);
  else for (const audience of metadata.audience) if (!allowedAudiences.has(audience)) failures.push(`${file}: unsupported audience ${audience}`);
  const verification = metadata.verification;
  if (!verification || !['draft', 'source', 'test', 'runtime'].includes(verification.level)) {
    failures.push(`${file}: verification.level must be draft, source, test, or runtime`);
  } else if (verification.level !== 'draft') {
    if (!verification.verified_at) failures.push(`${file}: verified pages require verification.verified_at`);
    if (!Array.isArray(verification.evidence) || verification.evidence.length === 0) failures.push(`${file}: verified pages require verification.evidence`);
  }
}

if (failures.length) {
  console.error(`Documentation frontmatter failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('Documentation frontmatter contract passed.');
