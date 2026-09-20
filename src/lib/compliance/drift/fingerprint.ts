import { createHash } from 'node:crypto';
import { canonicalizeEvidenceValue } from '../evidence/canonicalize';
import type {
  ComplianceObservation,
  ObservationFinding,
  ObservationEvidenceIntegrity,
} from './types';

/**
 * Deterministically sorts finding items by code, then severity.
 */
function canonicalizeFindings(
  findings: readonly ObservationFinding[]
): Array<{ code: string; severity: string }> {
  return [...findings]
    .map(f => ({
      code: String(f.code || '').trim(),
      severity: String(f.severity || '')
        .trim()
        .toUpperCase(),
    }))
    .sort((a, b) => {
      const cmpCode = a.code.localeCompare(b.code);
      if (cmpCode !== 0) return cmpCode;
      return a.severity.localeCompare(b.severity);
    });
}

/**
 * Computes a deterministic SHA-256 fingerprint for a finding set.
 * Wording or free-text descriptions are excluded to prevent spurious drift.
 */
export function computeFindingSetFingerprint(findings: readonly ObservationFinding[]): string {
  const canonical = canonicalizeFindings(findings);
  const json = JSON.stringify(canonicalizeEvidenceValue(canonical));
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Computes a deterministic SHA-256 fingerprint for evidence integrity state.
 */
export function computeEvidenceIntegrityFingerprint(
  integrity: ObservationEvidenceIntegrity
): string {
  const canonical = {
    total: Math.max(0, Math.floor(integrity.total || 0)),
    mismatches: Math.max(0, Math.floor(integrity.mismatches || 0)),
  };
  const json = JSON.stringify(canonicalizeEvidenceValue(canonical));
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Computes a deterministic SHA-256 fingerprint for a technical observation.
 *
 * Excludes:
 * - Timestamps (evaluatedAt, observedAt, validUntil)
 * - Summaries and human prose
 * - Random identifiers and UUIDs
 *
 * Includes:
 * - Control ID
 * - Status
 * - Evaluator ID and version
 * - Canonical sorted findings
 * - Evidence integrity numbers
 */
export function computeComplianceObservationFingerprint(
  observation: ComplianceObservation
): string {
  const canonicalObservation = {
    controlId: observation.controlId,
    status: observation.status,
    evaluatorId: observation.evaluatorId,
    evaluatorVersion: observation.evaluatorVersion,
    findings: canonicalizeFindings(observation.findings),
    evidenceIntegrity: {
      total: Math.max(0, Math.floor(observation.evidenceIntegrity.total || 0)),
      mismatches: Math.max(0, Math.floor(observation.evidenceIntegrity.mismatches || 0)),
    },
  };

  const json = JSON.stringify(canonicalizeEvidenceValue(canonicalObservation));
  return createHash('sha256').update(json, 'utf8').digest('hex');
}
