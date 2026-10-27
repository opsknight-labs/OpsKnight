#!/usr/bin/env node
'use strict';
// Fails on any high/critical production advisory that is not in the reviewed, expiring baseline.
// The baseline records advisories already present on the base branch so a feature branch is
// judged on what it introduces; every entry needs a justification and an expiry.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const BLOCKING = new Set(['high', 'critical']);

function advisoryIds(vulnerability) {
  return (vulnerability.via || [])
    .filter(entry => typeof entry === 'object' && entry.url)
    .map(entry => entry.url.split('/').pop());
}

function evaluateAudit(audit, baseline, now = new Date()) {
  const known = new Map(baseline.advisories.map(entry => [entry.id, entry]));
  const findings = [];
  const blocking = [];
  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities || {})) {
    if (!BLOCKING.has(vulnerability.severity)) continue;
    const ids = advisoryIds(vulnerability);
    // A transitive entry has no advisory of its own; it is covered by its causes.
    if (!ids.length) continue;
    for (const id of ids) {
      const entry = known.get(id);
      const state = !entry
        ? 'NEW'
        : new Date(entry.expires) <= now
          ? 'BASELINE_EXPIRED'
          : entry.package !== name
            ? 'BASELINE_PACKAGE_MISMATCH'
            : 'ACCEPTED';
      findings.push({ id, package: name, severity: vulnerability.severity, state });
      if (state !== 'ACCEPTED') blocking.push({ id, package: name, state });
    }
  }
  const stale = baseline.advisories
    .filter(entry => !findings.some(finding => finding.id === entry.id))
    .map(entry => entry.id);
  return { ok: blocking.length === 0, findings, blocking, staleBaselineEntries: stale };
}

function validateBaseline(baseline) {
  for (const entry of baseline.advisories) {
    for (const field of ['id', 'package', 'justification', 'expires', 'owner'])
      if (!entry[field] || typeof entry[field] !== 'string')
        throw new Error(`Baseline entry ${entry.id || '?'} is missing ${field}`);
    if (!/^GHSA-[a-z0-9-]+$/.test(entry.id)) throw new Error(`Invalid advisory id ${entry.id}`);
    if (Number.isNaN(Date.parse(entry.expires))) throw new Error(`Invalid expiry for ${entry.id}`);
  }
}

module.exports = { evaluateAudit, validateBaseline };

if (require.main === module) {
  const baselinePath = process.argv[2];
  const outputPath = process.argv[3];
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  validateBaseline(baseline);
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm exits non-zero when vulnerabilities exist; the JSON is still on stdout.
    raw = error.stdout;
    if (!raw) throw error;
  }
  const audit = JSON.parse(raw);
  const result = evaluateAudit(audit, baseline);
  const report = {
    generatedAt: new Date().toISOString(),
    counts: audit.metadata && audit.metadata.vulnerabilities,
    ...result,
  };
  if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}
