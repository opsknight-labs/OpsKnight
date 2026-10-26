#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { filesUnder, readRepositoryFile, repositoryRoot } from './discovery-lib.mjs';

const versions = JSON.parse(readFileSync(resolve(repositoryRoot, 'docs/versions.json'), 'utf8'));
const currentDocsVersion = versions.currentRelease || 'v2.0.0';

const risky = /\b(?:only|single|always|never|maximum|minimum|up to|exactly|supports?|does not support|default|per minute|per second|seconds?|minutes?|MB|KB)\b/i;
const failures = [];
let claims = 0;
for (const file of filesUnder(`docs/${currentDocsVersion}`, path => path.endsWith('.md'))) {
  const body = readRepositoryFile(file);
  const header = body.match(/^---\n([\s\S]*?)\n---/)?.[1];
  const metadata = header ? YAML.parse(header) : null;
  const lines = body.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (!risky.test(lines[index]) || lines[index].startsWith('keywords:')) continue;
    claims += 1;
    if (!metadata?.verification?.level || !(metadata.verification.evidence?.length)) {
      failures.push(`${file}:${index + 1}: absolute or numeric claim lacks page evidence`);
    }
  }
}
if (failures.length) {
  console.error(`Dangerous-claim evidence check failed (${failures.length}):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Dangerous-claim evidence check passed for ${claims} claim-bearing lines.`);
