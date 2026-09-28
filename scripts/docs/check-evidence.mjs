#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { exists, filesUnder, readRepositoryFile, repositoryRoot } from './discovery-lib.mjs';

const inventory = YAML.parse(readFileSync(resolve(repositoryRoot, 'docs/v2.0.0/capabilities.yaml'), 'utf8'));
const failures = [];
const assetManifest = YAML.parse(readRepositoryFile('docs/v2.0.0/assets/manifest.yaml'));
if (!assetManifest.runtimeImage?.includes('@sha256:')) failures.push('reader assets: runtime image is not immutable');
for (const revisionField of ['approvedSourceRevision', 'runtimeSourceRevision']) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', assetManifest[revisionField], 'HEAD'], { cwd: repositoryRoot });
  } catch {
    failures.push(`reader assets: ${revisionField} is not an ancestor of HEAD`);
  }
}
for (const [asset, record] of Object.entries(assetManifest.assets ?? {})) {
  const publicFile = `docs/v2.0.0/assets/${asset}`;
  const evidenceFile = `${assetManifest.source}/${record.evidence}`;
  if (!exists(publicFile)) failures.push(`reader asset ${asset}: missing ${publicFile}`);
  if (!exists(evidenceFile)) failures.push(`reader asset ${asset}: missing current evidence route ${evidenceFile}`);
  if (exists(publicFile)) {
    const publicHash = createHash('sha256').update(readFileSync(resolve(repositoryRoot, publicFile))).digest('hex');
    if (publicHash !== record.sha256) failures.push(`reader asset ${asset}: digest differs from manifest`);
  }
}
for (const [id, capability] of Object.entries(inventory.capabilities ?? {})) {
  for (const evidence of capability.evidence ?? []) {
    if (!exists(evidence)) failures.push(`${id}: missing evidence ${evidence}`);
    const metadata = evidence.replace(/\.png$/, '.json');
    if (evidence.endsWith('.png') && !exists(metadata)) failures.push(`${id}: missing metadata ${metadata}`);
  }
}
if (exists('generated/docs-evidence')) {
  for (const file of filesUnder('generated/docs-evidence', path => path.endsWith('.json'))) {
    let metadata;
    try { metadata = JSON.parse(readRepositoryFile(file)); }
    catch (error) { failures.push(`${file}: invalid JSON (${error.message})`); continue; }
    for (const field of ['release', 'sourceRevision', 'route', 'journey', 'browser', 'viewport', 'runtime']) if (!metadata[field]) failures.push(`${file}: missing ${field}`);
    if (metadata.runtime) {
      for (const field of ['requestedImage', 'digest', 'sourceRevision']) if (!metadata.runtime[field]) failures.push(`${file}: missing runtime.${field}`);
      if (!metadata.runtime.requestedImage?.includes('@sha256:')) failures.push(`${file}: runtime image is not immutable`);
      if (!metadata.runtime.digest?.includes('@sha256:')) failures.push(`${file}: runtime digest is not immutable`);
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', metadata.runtime.sourceRevision, 'HEAD'], { cwd: repositoryRoot });
      } catch {
        failures.push(`${file}: runtime source revision is not an ancestor of HEAD`);
      }
    }
  }
}
if (failures.length) {
  console.error(`Documentation evidence failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('Documentation evidence contract passed.');
