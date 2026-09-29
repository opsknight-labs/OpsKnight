#!/usr/bin/env node
import YAML from 'yaml';
import { filesUnder, readRepositoryFile } from './discovery-lib.mjs';

const risky = /\b(?:only|single|always|never|maximum|minimum|up to|exactly|supports?|does not support|default|per minute|per second|seconds?|minutes?|MB|KB)\b/i;
const failures = [];
let claims = 0;
for (const file of filesUnder('docs/v2.0.0', path => path.endsWith('.md'))) {
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
