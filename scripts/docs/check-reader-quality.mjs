#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { filesUnder, repositoryRoot } from './discovery-lib.mjs';

const failures = [];
const release = process.argv.includes('--release');
const readerOrder = ['DISCOVERED', 'MAPPED', 'DRAFTED', 'READER_COMPLETE', 'HUMAN_VERIFIED', 'RUNTIME_VERIFIED'];
const taskTypes = new Set(['how-to', 'tutorial', 'deployment', 'integration', 'troubleshooting']);
const atLeast = (status, minimum) => readerOrder.indexOf(status) >= readerOrder.indexOf(minimum);
const hasHeading = (body, patterns) => patterns.some(pattern => new RegExp(`^##\\s+(?:${pattern})`, 'im').test(body));
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
  const readerStatus = metadata.reader?.status ?? 'MAPPED';
  if (!readerOrder.includes(readerStatus)) failures.push(`${file}: invalid reader status ${readerStatus}`);
  if (taskTypes.has(metadata.type) && release && !atLeast(readerStatus, 'HUMAN_VERIFIED')) {
    failures.push(`${file}: release task page is ${readerStatus}; HUMAN_VERIFIED is required`);
  }
  if (atLeast(readerStatus, 'READER_COMPLETE') && taskTypes.has(metadata.type) && !metadata.reader?.task) {
    failures.push(`${file}: reader-complete task page needs reader.task`);
  }
  if (atLeast(readerStatus, 'HUMAN_VERIFIED')) {
    if (!metadata.reader?.reviewer?.trim()) failures.push(`${file}: human verification needs reviewer`);
    if (!metadata.reader?.reviewed_at) failures.push(`${file}: human verification needs reviewed_at`);
    if (!metadata.reader?.revision) failures.push(`${file}: human verification needs revision`);
    if (!metadata.reader?.evidence?.length) failures.push(`${file}: human verification needs evidence`);
  }
  if (readerStatus === 'RUNTIME_VERIFIED' && !metadata.reader?.journey) failures.push(`${file}: runtime verification needs journey`);

  if ((metadata.type === 'how-to' || metadata.type === 'tutorial') && !file.endsWith('/README.md')) {
    if (!/(## Before you begin|## Prerequisites)/i.test(body)) failures.push(`${file}: task page needs prerequisites`);
    if (!/^\d+\.\s/m.test(body)) failures.push(`${file}: task page needs ordered steps`);
    if (!/(## Verify|confirm|verify)/i.test(body)) failures.push(`${file}: task page needs a verification outcome`);
  }
  if (atLeast(readerStatus, 'READER_COMPLETE') && metadata.type === 'how-to') {
    const requirements = [
      ['prerequisites', ['Before you begin', 'Prerequisites']],
      ['open the feature', ['Open the feature', 'Open .*']],
      ['configuration', ['Configure', 'Configuration']],
      ['behavior', ['What OpsKnight does', 'How .* works', 'Understand .*']],
      ['verification', ['Verify', 'Expected result']],
      ['reversal', ['Change or undo', 'Undo', 'Remove', 'Revoke', 'Disconnect', 'Roll back', 'Rollback', 'Delete']],
      ['troubleshooting', ['Troubleshooting']],
      ['next steps', ['Next steps', 'Related guides', 'Related pages']],
    ];
    for (const [name, patterns] of requirements) {
      if (!hasHeading(body, patterns)) failures.push(`${file}: reader-complete how-to needs ${name} section`);
    }
  }
  if (atLeast(readerStatus, 'READER_COMPLETE') && metadata.type === 'deployment') {
    const requirements = [
      ['prerequisites', ['Prerequisites', 'Before you begin', 'Before you start']],
      ['configuration', ['Configure', 'Configuration', 'Prepare']],
      ['installation or execution', ['Install', 'Deploy', 'Apply', 'Run', 'Upgrade', 'Restore']],
      ['validation', ['Verify', 'Validation', 'Acceptance']],
      ['production considerations', ['Production', 'Security', 'Operate', 'Routine operations']],
      ['troubleshooting', ['Troubleshooting', 'Failure handling', 'If .* fails']],
    ];
    for (const [name, patterns] of requirements) {
      if (!hasHeading(body, patterns)) failures.push(`${file}: reader-complete deployment page needs ${name}`);
    }
  }
  if (atLeast(readerStatus, 'READER_COMPLETE') && metadata.type === 'integration') {
    const requirements = [
      ['prerequisites', ['Prerequisites']],
      ['connect', ['Connect', 'Setup and configuration', 'Provider-side setup']],
      ['verify', ['Verify', 'Test']],
      ['use', ['Use', 'Incident', 'Event mapping']],
      ['troubleshooting', ['Troubleshooting']],
    ];
    for (const [name, patterns] of requirements) {
      if (!hasHeading(body, patterns)) failures.push(`${file}: reader-complete integration page needs ${name}`);
    }
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
