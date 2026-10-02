#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from './discovery-lib.mjs';

const revisionBoundJson = new Set([
  'generated/docs-discovery/current.json',
  'generated/docs-contracts/current.json',
]);

export const generatedPaths = [
  ...revisionBoundJson,
  'generated/docs-contracts/capacity.json',
  'generated/docs-contracts/routes.json',
  'generated/docs-contracts/integrations.json',
  'generated/docs-reference',
  'generated/docs-certification/v15-parity-report.md',
  'docs/internal/certification/v1.5-topic-inventory.yaml',
  'docs/v2.0.0/integrations/catalog.yaml',
  'docs/v2.0.0/reference/features.md',
  'docs/v2.0.0/reference/configuration/README.md',
  'docs/v2.0.0/reference/api/README.md',
];

function committed(path) {
  return execFileSync('git', ['show', `HEAD:${path}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
}

function withoutRevisionMetadata(value) {
  const copy = structuredClone(value);
  delete copy.sourceRevision;
  delete copy.generatedAt;
  return copy;
}

export function revisionOnlyDrift(path) {
  const before = withoutRevisionMetadata(JSON.parse(committed(path)));
  const after = withoutRevisionMetadata(JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8')));
  return JSON.stringify(before) === JSON.stringify(after);
}

export function checkGeneratedDrift({ allowRevisionOnly = true } = {}) {
  const changed = execFileSync('git', ['diff', '--name-only', '--', ...generatedPaths], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean);

  const rejected = changed.filter(path => !(
    allowRevisionOnly && revisionBoundJson.has(path) && revisionOnlyDrift(path)
  ));

  if (rejected.length > 0) {
    console.error(`Generated documentation drift detected:\n${rejected.map(path => `- ${path}`).join('\n')}`);
    return false;
  }

  if (changed.length > 0) {
    console.log('Only commit-bound revision metadata changed; generated content is current.');
  } else {
    console.log('Generated documentation artifacts are current.');
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ok = checkGeneratedDrift({ allowRevisionOnly: process.env.DOCS_ALLOW_REVISION_ONLY_DRIFT === 'true' });
  if (!ok) process.exitCode = 1;
}
