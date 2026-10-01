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
const markdownFiles = filesUnder('docs/v2.0.0', path => path.endsWith('.md'));

// A page and a same-named directory landing normalize to the same public URL.
// Reject the pair so the website cannot shadow README.md or emit duplicate nav.
const markdownSet = new Set(markdownFiles);
for (const file of markdownFiles) {
  if (!file.endsWith('/README.md')) continue;
  const siblingPage = `${file.slice(0, -'/README.md'.length)}.md`;
  if (markdownSet.has(siblingPage)) {
    failures.push(`${siblingPage} and ${file}: duplicate documentation URL slug`);
  }
}

for (const file of markdownFiles) {
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
  const reader = metadata.reader;
  if (reader?.status === 'HUMAN_VERIFIED' || reader?.status === 'RUNTIME_VERIFIED') {
    for (const evidence of reader.evidence ?? []) if (!exists(evidence)) failures.push(`${file}: missing reader evidence ${evidence}`);
  }
  if (reader?.status === 'RUNTIME_VERIFIED' && reader.journey && !exists(reader.journey)) {
    failures.push(`${file}: missing reader journey ${reader.journey}`);
  }
}

if (failures.length) {
  console.error(`Documentation frontmatter failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('Documentation frontmatter contract passed.');
