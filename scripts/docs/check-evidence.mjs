#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { exists, filesUnder, readRepositoryFile, repositoryRoot } from './discovery-lib.mjs';
import { isImmutableContainerReference } from './immutable-container-reference.mjs';

const inventory = YAML.parse(readFileSync(resolve(repositoryRoot, 'docs/v2.0.0/capabilities.yaml'), 'utf8'));
const failures = [];
const assetManifest = YAML.parse(readRepositoryFile('docs/v2.0.0/assets/manifest.yaml'));
const acceptedSquashMerges = new Map(
  (assetManifest.acceptedSquashMerges ?? []).map(record => [record.sourceRevision, record.mergedRevision])
);
for (const record of assetManifest.acceptedSquashMerges ?? []) {
  if (!/^[0-9a-f]{40}$/.test(record.sourceRevision ?? '')) failures.push('reader assets: squash source revision is invalid');
  if (!/^[0-9a-f]{40}$/.test(record.mergedRevision ?? '')) failures.push('reader assets: squash merge revision is invalid');
  if (!record.reason) failures.push('reader assets: squash merge acceptance is missing a reason');
}

function revisionIsAccepted(revision) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', revision, 'HEAD'], { cwd: repositoryRoot });
    return true;
  } catch {
    const mergedRevision = acceptedSquashMerges.get(revision);
    if (!mergedRevision) return false;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', mergedRevision, 'HEAD'], { cwd: repositoryRoot });
      return true;
    } catch {
      return false;
    }
  }
}

if (!isImmutableContainerReference(assetManifest.runtimeImage)) failures.push('reader assets: runtime image is not immutable');
for (const revisionField of ['approvedSourceRevision', 'runtimeSourceRevision']) {
  if (!revisionIsAccepted(assetManifest[revisionField])) failures.push(`reader assets: ${revisionField} is not in the accepted HEAD lineage`);
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
for (const [asset, record] of Object.entries(assetManifest.manualAssets ?? {})) {
  const publicFile = `docs/v2.0.0/assets/${asset}`;
  if (!exists(publicFile)) failures.push(`manual reader asset ${asset}: missing ${publicFile}`);
  if (!record.provenance) failures.push(`manual reader asset ${asset}: missing provenance`);
  if (!record.classification) failures.push(`manual reader asset ${asset}: missing classification`);
  if (exists(publicFile)) {
    const publicHash = createHash('sha256').update(readFileSync(resolve(repositoryRoot, publicFile))).digest('hex');
    if (publicHash !== record.sha256) failures.push(`manual reader asset ${asset}: digest differs from manifest`);
  }
}
const registeredAssets = new Set([
  ...Object.keys(assetManifest.assets ?? {}),
  ...Object.keys(assetManifest.manualAssets ?? {}),
]);
for (const file of filesUnder('docs/v2.0.0/assets', path => /\.(?:png|jpe?g|webp|gif|svg)$/i.test(path))) {
  const asset = file.replace('docs/v2.0.0/assets/', '');
  if (!registeredAssets.has(asset)) failures.push(`reader asset ${asset}: not registered in assets/manifest.yaml`);
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
      if (!isImmutableContainerReference(metadata.runtime.requestedImage)) failures.push(`${file}: runtime image is not immutable`);
      if (!isImmutableContainerReference(metadata.runtime.digest)) failures.push(`${file}: runtime digest is not immutable`);
      if (!revisionIsAccepted(metadata.runtime.sourceRevision)) failures.push(`${file}: runtime source revision is not in the accepted HEAD lineage`);
    }
  }
}
if (failures.length) {
  console.error(`Documentation evidence failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('Documentation evidence contract passed.');
