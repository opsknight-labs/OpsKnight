#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { filesUnder, repositoryRoot } from './discovery-lib.mjs';

const failures = [];
const pages = filesUnder('docs/v2.0.0', file => file.endsWith('.md')).map(file => {
  const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { file, metadata: {}, body: source };
  return { file, metadata: YAML.parse(match[1]), body: match[2] };
});

const titleOwners = new Map();
for (const page of pages) {
  const { file, metadata, body } = page;
  const title = metadata.title?.trim();
  if (!title) continue;
  const normalizedTitle = title.toLowerCase();
  const prior = titleOwners.get(normalizedTitle);
  if (prior && prior !== file) failures.push(`${file}: duplicate searchable title also used by ${prior}`);
  else titleOwners.set(normalizedTitle, file);
  if (!metadata.description || metadata.description.length < 25) failures.push(`${file}: search description is missing or too short`);

  if ((metadata.type === 'how-to' || metadata.type === 'tutorial') && !file.endsWith('/README.md')) {
    if (!/(## Before you begin|## Prerequisites)/i.test(body)) failures.push(`${file}: task page needs prerequisites`);
    if (!/^\d+\.\s/m.test(body)) failures.push(`${file}: task page needs ordered steps`);
    if (!/(## Verify|confirm|verify)/i.test(body)) failures.push(`${file}: task page needs a verification outcome`);
  }
  if (metadata.type === 'integration' && /integrations\/(?:monitoring|cloud|uptime|webhooks)\//.test(file)) {
    for (const heading of ['Prerequisites', 'Setup and configuration', 'Verify the connection', 'Troubleshooting', 'Related pages']) {
      if (!body.includes(`## ${heading}`)) failures.push(`${file}: integration page needs “${heading}”`);
    }
  }
  if (metadata.type === 'troubleshooting' && !file.endsWith('/README.md')) {
    const symptoms = [...body.matchAll(/^##\s+/gm)].length;
    if (symptoms < 1) failures.push(`${file}: troubleshooting page needs symptom sections`);
    if (!/(check|confirm|verify|inspect|restart|retry|restore|fix)/i.test(body)) failures.push(`${file}: troubleshooting page needs diagnostic or recovery actions`);
  }
}

if (failures.length) {
  console.error(`Reader documentation quality failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(`Reader documentation quality passed for ${pages.length} pages with unique searchable titles.`);
