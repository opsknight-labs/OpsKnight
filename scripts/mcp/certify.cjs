'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isIP } = require('node:net');

const MAX_EVIDENCE_BYTES = 1024 * 1024;
const SHA_RE = /^[a-f0-9]{40}$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const REQUIRED_GATES = Object.freeze([
  'architecture', 'protocol', 'oauth', 'rbac', 'workflowParity', 'approvals',
  'durableTasks', 'mixedLoad', 'faultTolerance', 'clients', 'deployment',
  'migrationUpgrade', 'security', 'documentation',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate a reference without fetching it. Content/provenance must be reviewed separately. */
function validHttpsArtifactUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || value.includes('#'))
    return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return url.protocol === 'https:' &&
    hostname.length > 0 && hostname.includes('.') && !hostname.endsWith('.') &&
    hostname !== 'localhost' && !hostname.endsWith('.localhost') && !hostname.endsWith('.local') &&
    isIP(hostname) === 0 && !url.username && !url.password && !url.hash &&
    (!url.port || url.port === '443');
}

function validUtcTimestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/**
 * Validate the reviewed release manifest against the exact checked-out source SHA.
 * This checks manifest shape and references; it does not independently prove the truth of
 * linked test results or image provenance. The protected GitHub environment is the release
 * approval boundary and reviewers must inspect the referenced artifacts.
 */
function validateEvidence(evidence, revision, now = new Date()) {
  const errors = [];
  if (!SHA_RE.test(revision)) errors.push('runningRevision');
  if (!isRecord(evidence)) return ['manifest'];
  if (evidence.schemaVersion !== 1) errors.push('schemaVersion');
  if (!SHA_RE.test(evidence.sourceRevision || '') || evidence.sourceRevision !== revision)
    errors.push('sourceRevision');
  if (!DIGEST_RE.test(evidence.imageDigest || '')) errors.push('imageDigest');
  if (!SHA_RE.test(evidence.imageSourceRevision || '') || evidence.imageSourceRevision !== revision)
    errors.push('imageSourceRevision');
  if (!validHttpsArtifactUrl(evidence.imageProvenanceUrl)) errors.push('imageProvenanceUrl');

  const review = evidence.review;
  if (!isRecord(review)) {
    errors.push('review');
  } else {
    if (typeof review.reviewedBy !== 'string' ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(review.reviewedBy))
      errors.push('review.reviewedBy');
    if (!validUtcTimestamp(review.reviewedAt)) errors.push('review.reviewedAt');
    else if (Date.parse(review.reviewedAt) > now.getTime() + 5 * 60 * 1000)
      errors.push('review.reviewedAt');
    if (!validHttpsArtifactUrl(review.referenceUrl)) errors.push('review.referenceUrl');
  }

  if (!isRecord(evidence.gates)) return [...new Set([...errors, 'gates'])];
  for (const gate of Object.keys(evidence.gates).filter(key => !REQUIRED_GATES.includes(key)))
    errors.push('gates.unknown:' + gate);
  for (const gate of REQUIRED_GATES) {
    const row = evidence.gates[gate];
    if (!isRecord(row)) {
      errors.push('gates.' + gate);
      continue;
    }
    if (row.status !== 'passed') errors.push('gates.' + gate + '.status');
    if (row.sourceRevision !== revision) errors.push('gates.' + gate + '.sourceRevision');
    if (!Array.isArray(row.artifactUrls) || row.artifactUrls.length < 1 || row.artifactUrls.length > 20) {
      errors.push('gates.' + gate + '.artifactUrls');
      continue;
    }
    if (new Set(row.artifactUrls).size !== row.artifactUrls.length ||
        !row.artifactUrls.every(validHttpsArtifactUrl))
      errors.push('gates.' + gate + '.artifactUrls');
  }
  return [...new Set(errors)];
}

function isWithinDirectory(root, target) {
  const relative = path.relative(root, target);
  return relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

/** Load a small regular JSON file whose resolved path is outside the checkout. */
function loadEvidenceFile(evidencePath, repositoryRoot = process.cwd()) {
  if (typeof evidencePath !== 'string' || evidencePath.length === 0)
    throw new Error('MCP_RELEASE_EVIDENCE must point to a reviewed manifest outside the repository');
  const root = fs.realpathSync(repositoryRoot);
  const absolute = fs.realpathSync(path.resolve(evidencePath));
  if (isWithinDirectory(root, absolute))
    throw new Error('Release evidence must remain outside the repository');
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw new Error('Release evidence must be a regular file');
  if (stat.size > MAX_EVIDENCE_BYTES) throw new Error('Release evidence exceeds the 1 MiB limit');
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

function run() {
  let revision = 'unknown';
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (!process.env.MCP_RELEASE_EVIDENCE)
      throw new Error('MCP_RELEASE_EVIDENCE must identify the reviewed release manifest outside the repository');
    const evidence = loadEvidenceFile(process.env.MCP_RELEASE_EVIDENCE, process.cwd());
    const errors = validateEvidence(evidence, revision);
    if (errors.length) throw new Error('missing/mismatched evidence: ' + errors.join(', '));
    process.stdout.write('Reviewed MCP release evidence covers ' + revision + '.\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write('MCP GA blocked at ' + revision + ': ' + message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { REQUIRED_GATES, validHttpsArtifactUrl, validateEvidence, loadEvidenceFile };
if (require.main === module) run();
