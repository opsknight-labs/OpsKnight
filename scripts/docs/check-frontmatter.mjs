#!/usr/bin/env node
import YAML from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { exists, filesUnder, readRepositoryFile } from './discovery-lib.mjs';

const schema = JSON.parse(readRepositoryFile('docs/v2.0.0/metadata.schema.json'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
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
  if (!validate(metadata)) {
    for (const error of validate.errors ?? []) {
      failures.push(`${file}: metadata${error.instancePath || '/'} ${error.message}`);
    }
    continue;
  }
  const verification = metadata.verification;
  if (verification.level !== 'draft') {
    for (const evidence of verification.evidence) if (!exists(evidence)) failures.push(`${file}: missing verification evidence ${evidence}`);
  }
}

if (failures.length) {
  console.error(`Documentation frontmatter failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('Documentation frontmatter contract passed.');
