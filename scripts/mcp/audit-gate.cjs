#!/usr/bin/env node
'use strict';
// Fails on any moderate/high/critical production advisory that is not in the reviewed, expiring baseline.
// A malformed or failed npm audit response must fail closed, never look like a clean audit.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const BLOCKING = new Set(['moderate', 'high', 'critical']);
const SEVERITIES = new Set(['info', 'low', 'moderate', 'high', 'critical']);
const COUNT_FIELDS = ['info', 'low', 'moderate', 'high', 'critical', 'total'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function advisoryIds(vulnerability) {
  return (vulnerability.via || [])
    .filter(entry => typeof entry === 'object' && entry.url)
    .map(entry => entry.url.split('/').pop());
}

function validateAuditReport(audit) {
  if (
    !isRecord(audit) ||
    !isRecord(audit.vulnerabilities) ||
    !isRecord(audit.metadata) ||
    !isRecord(audit.metadata.vulnerabilities)
  )
    throw new Error('npm audit did not return a complete JSON audit report; refusing to pass');
  const counts = audit.metadata.vulnerabilities;
  if (
    !COUNT_FIELDS.every(field => Number.isSafeInteger(counts[field]) && counts[field] >= 0) ||
    counts.total !== COUNT_FIELDS.slice(0, -1).reduce((sum, field) => sum + counts[field], 0)
  )
    throw new Error('npm audit returned invalid vulnerability counts; refusing to pass');

  const vulnerabilities = audit.vulnerabilities;
  const rows = Object.entries(vulnerabilities);
  for (const [name, vulnerability] of rows) {
    if (
      !isRecord(vulnerability) ||
      !SEVERITIES.has(vulnerability.severity) ||
      !Array.isArray(vulnerability.via) ||
      vulnerability.via.length === 0
    )
      throw new Error('npm audit returned a malformed vulnerability entry for ' + name);
    for (const cause of vulnerability.via) {
      if (typeof cause === 'string' && cause.length > 0) continue;
      if (
        isRecord(cause) &&
        typeof cause.url === 'string' &&
        cause.url.length > 0 &&
        cause.url.startsWith('https://')
      )
        continue;
      throw new Error('npm audit returned a malformed advisory cause for ' + name);
    }
  }

  const blockingCount = counts.moderate + counts.high + counts.critical;
  const blockingRows = rows.filter(([, vulnerability]) => BLOCKING.has(vulnerability.severity));
  if (blockingCount > 0 !== blockingRows.length > 0)
    throw new Error(
      'npm audit vulnerability counts disagree with package details; refusing to pass'
    );

  // A transitive row can name the vulnerable package rather than repeating its advisory URL.
  // It is safe to skip that row only when the referenced package has an explicit advisory URL.
  for (const [name, vulnerability] of blockingRows) {
    if (advisoryIds(vulnerability).length > 0) continue;
    const causes = vulnerability.via.filter(cause => typeof cause === 'string');
    if (
      !causes.some(
        cause => isRecord(vulnerabilities[cause]) && advisoryIds(vulnerabilities[cause]).length > 0
      )
    )
      throw new Error('npm audit has no verifiable advisory cause for blocking package ' + name);
  }
  return audit;
}

function evaluateAudit(audit, baseline, now = new Date()) {
  const known = new Map(baseline.advisories.map(entry => [entry.id, entry]));
  const findings = [];
  const blocking = [];
  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities || {})) {
    if (!BLOCKING.has(vulnerability.severity)) continue;
    const ids = advisoryIds(vulnerability);
    // A transitive entry has no advisory of its own; its named cause is checked above.
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
  if (!isRecord(baseline) || !Array.isArray(baseline.advisories))
    throw new Error('Dependency audit baseline must contain an advisories array');
  const seen = new Set();
  for (const entry of baseline.advisories) {
    if (!isRecord(entry)) throw new Error('Dependency audit baseline entries must be objects');
    for (const field of ['id', 'package', 'justification', 'expires', 'owner'])
      if (typeof entry[field] !== 'string' || !entry[field].trim())
        throw new Error('Baseline entry ' + (entry.id || '?') + ' is missing ' + field);
    if (!/^GHSA-[a-z0-9-]+$/.test(entry.id)) throw new Error('Invalid advisory id ' + entry.id);
    if (seen.has(entry.id)) throw new Error('Duplicate advisory id ' + entry.id);
    seen.add(entry.id);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires) ||
      Number.isNaN(Date.parse(entry.expires)) ||
      new Date(entry.expires).toISOString().slice(0, 10) !== entry.expires
    )
      throw new Error('Invalid expiry for ' + entry.id);
  }
}

module.exports = { evaluateAudit, validateBaseline, validateAuditReport };

if (require.main === module) {
  try {
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
    const audit = validateAuditReport(JSON.parse(raw));
    const result = evaluateAudit(audit, baseline);
    const report = {
      generatedAt: new Date().toISOString(),
      counts: audit.metadata.vulnerabilities,
      ...result,
    };
    if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write('Dependency audit gate failed closed: ' + message + '\n');
    process.exitCode = 1;
  }
}
